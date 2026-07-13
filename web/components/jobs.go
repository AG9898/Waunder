package components

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/maxence-charriere/go-app/v10/pkg/app"
)

// loadState tracks the async fetch lifecycle shared by the data screens.
type loadState int

const (
	loadIdle loadState = iota
	loadLoading
	loadDone
	loadError
)

const sessionExpiredMessage = "Your session expired. Please sign in again."

const (
	jobListScored   = "scored"
	jobListUnscored = "unscored"
)

// Lifecycle bins the feed can show. These mirror the Rails JobPost lifecycle
// states; "active" is the default working set.
const (
	jobStateActive  = "active"
	jobStateBacklog = "backlog"
	jobStateRemoved = "removed"
)

// Sort modes for the feed: oldest-first (default) or highest-score-first.
const (
	jobSortOldest = "oldest"
	jobSortScore  = "score"
)

const jobsPageSize = 30

type scoreRequestState int

const (
	scoreIdle scoreRequestState = iota
	scoreRequesting
	scoreRequestError
)

// JobList renders the job feed backed by GET /api/job_posts. It exposes the
// server-side controls Rails supports: a scored/unscored status toggle,
// lifecycle bin tabs (Active default / Backlog / Removed), filter controls
// (score band, source, location, ingestion-date range), a sort toggle (oldest
// default vs highest-score), and Prev/Next pagination reading the page
// envelope. All fetching is on explicit user action — the only implicit fetch
// is the initial load on mount/pre-render.
type JobList struct {
	app.Compo

	// Client is the Rails client; tests inject a mock and it defaults to the
	// same-origin HTTP client on mount.
	Client RailsClient

	state loadState
	jobs  []JobSummary
	page  PageMeta
	err   string

	// view is the scored/unscored status toggle.
	view string
	// state bin (active/backlog/removed), sort mode, and the filter selections
	// that feed JobFeedParams. The current 1-based page is tracked separately so
	// Prev/Next can advance it without resetting the filters.
	bin       string
	sort      string
	scoreBand string
	source    string
	location  string
	dateFrom  string
	dateTo    string
	pageNum   int

	scoreStates map[int]scoreRequestState
	scoreErrs   map[int]string

	// selected tracks the ids checked for a bulk lifecycle action. It is keyed
	// by job id; only ids set true are included in a bulk transition.
	selected map[int]bool
	// lifecycleState is the shared in-flight state for lifecycle mutations
	// (per-row or bulk): "" idle, "busy" while a transition is in flight.
	lifecycleBusy bool
	lifecycleErr  string
}

func (j *JobList) OnMount(ctx app.Context) {
	j.ensureClient()
	j.restoreFilters(ctx.LocalStorage())
	j.load(ctx)
}

func (j *JobList) OnPreRender(ctx app.Context) { j.ensureClient(); j.load(ctx) }

// jobFiltersStorageKey namespaces the persisted filter selection in browser
// local storage.
const jobFiltersStorageKey = "waunder.jobFilters"

// jobFilterState is the JSON shape persisted to local storage so the feed can
// restore the last-used selection after navigating away (e.g. into a job)
// and back.
type jobFilterState struct {
	View      string `json:"view"`
	Bin       string `json:"bin"`
	Sort      string `json:"sort"`
	ScoreBand string `json:"score_band"`
	Source    string `json:"source"`
	Location  string `json:"location"`
	DateFrom  string `json:"date_from"`
	DateTo    string `json:"date_to"`
	PageNum   int    `json:"page_num"`
}

// restoreFilters loads the last-persisted filter selection into the
// component before its first fetch. Local storage is tied to the browser tab
// and outlives a single component instance (unlike the JobList struct, which
// the router recreates on every navigation to /jobs), so this is what makes
// the feed resume where the user left it. On server prerender / in tests,
// ctx.LocalStorage() is a fresh in-memory store with nothing saved yet, so
// this is a no-op there. Takes the storage directly (rather than app.Context)
// so it's unit-testable with a fake.
func (j *JobList) restoreFilters(storage app.BrowserStorage) {
	var saved jobFilterState
	if err := storage.Get(jobFiltersStorageKey, &saved); err != nil {
		return
	}
	j.view = saved.View
	j.bin = saved.Bin
	j.sort = saved.Sort
	j.scoreBand = saved.ScoreBand
	j.source = saved.Source
	j.location = saved.Location
	j.dateFrom = saved.DateFrom
	j.dateTo = saved.DateTo
	j.pageNum = saved.PageNum
}

// persistFilters saves the current filter selection so the next time the
// feed mounts (e.g. after navigating back from a job) it resumes here.
// Called from load(), so every fetch — initial mount, a filter/bin/sort/view
// change, or pagination — keeps storage in sync with what's on screen.
func (j *JobList) persistFilters(storage app.BrowserStorage) {
	storage.Set(jobFiltersStorageKey, jobFilterState{
		View:      j.view,
		Bin:       j.bin,
		Sort:      j.sort,
		ScoreBand: j.scoreBand,
		Source:    j.source,
		Location:  j.location,
		DateFrom:  j.dateFrom,
		DateTo:    j.dateTo,
		PageNum:   j.pageNum,
	})
}

func (j *JobList) ensureClient() {
	if j.Client == nil {
		j.Client = NewRailsClient()
	}
}

// feedParams builds the server query from the current selections, normalizing
// defaults so an unset component still requests scored + active + oldest, page 1.
func (j *JobList) feedParams() JobFeedParams {
	view := j.view
	if view == "" {
		view = jobListScored
	}
	bin := j.bin
	if bin == "" {
		bin = jobStateActive
	}
	sort := j.sort
	if sort == "" {
		sort = jobSortOldest
	}
	page := j.pageNum
	if page < 1 {
		page = 1
	}
	return JobFeedParams{
		Status:    view,
		State:     bin,
		Sort:      sort,
		ScoreBand: j.scoreBand,
		Source:    j.source,
		Location:  j.location,
		DateFrom:  j.dateFrom,
		DateTo:    j.dateTo,
		Page:      page,
	}
}

func (j *JobList) load(ctx app.Context) {
	j.normalizeDefaults()
	j.persistFilters(ctx.LocalStorage())
	j.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	params := j.feedParams()
	ctx.Async(func() {
		page, err := j.Client.Jobs(reqCtx, params)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &j.state, &j.err, err, func() {
				j.jobs = page.Jobs
				j.page = page.Page
			})
		})
	})
}

// normalizeDefaults seeds the unset selection fields so the component always has
// a concrete scored + active + oldest, page-1 state.
func (j *JobList) normalizeDefaults() {
	if j.view == "" {
		j.view = jobListScored
	}
	if j.bin == "" {
		j.bin = jobStateActive
	}
	if j.sort == "" {
		j.sort = jobSortOldest
	}
	if j.pageNum < 1 {
		j.pageNum = 1
	}
}

func (j *JobList) Render() app.UI {
	j.normalizeDefaults()
	return app.Div().Class("job-list").Body(
		renderAppTabs("jobs"),
		app.H1().Text("Jobs"),
		j.renderViewSelector(),
		j.renderBinTabs(),
		j.renderFilters(),
		renderLoad(j.state, j.err, func() app.UI {
			if len(j.jobs) == 0 {
				return app.P().Class("job-list-empty").Text(j.emptyText())
			}
			return app.Div().Class("job-list-results").Body(
				j.renderBulkActions(),
				app.Ul().Class("job-list-items").Body(
					app.Range(j.jobs).Slice(func(i int) app.UI {
						job := j.jobs[i]
						return j.renderJobRow(job)
					}),
				),
				j.renderPagination(),
			)
		}),
	)
}

func (j *JobList) renderViewSelector() app.UI {
	return app.Nav().Class("applications-view-selector job-list-view-selector").Attr("role", "tablist").Body(
		app.Button().
			Class("view-selector-option").
			Class(viewSelectorClass(j.view, jobListScored)).
			Attr("role", "tab").
			OnClick(j.showView(jobListScored)).
			Text("Scored"),
		app.Button().
			Class("view-selector-option").
			Class(viewSelectorClass(j.view, jobListUnscored)).
			Attr("role", "tab").
			OnClick(j.showView(jobListUnscored)).
			Text("Unscored"),
	)
}

// renderBinTabs renders the lifecycle bin selector (Active / Backlog / Removed),
// sitting alongside the scored/unscored toggle.
func (j *JobList) renderBinTabs() app.UI {
	tab := func(state, label string) app.UI {
		return app.Button().
			Class("job-bin-tab").
			Class(viewSelectorClass(j.bin, state)).
			Attr("role", "tab").
			OnClick(j.showBin(state)).
			Text(label)
	}
	return app.Nav().Class("job-bin-tabs").Attr("role", "tablist").Body(
		tab(jobStateActive, "Active"),
		tab(jobStateBacklog, "Backlog"),
		tab(jobStateRemoved, "Removed"),
	)
}

// renderFilters renders the filter controls (score band, source, location,
// ingestion-date range) and the oldest/highest-score sort toggle. Each control
// applies on change/click; no control fetches on initial render.
func (j *JobList) renderFilters() app.UI {
	// Tucked into a collapsible panel so the controls don't push the feed down
	// on mobile; the summary shows how many filters are currently applied.
	return app.Details().Class("job-filters-panel").Body(
		app.Summary().Class("job-filters-summary").Body(
			app.Span().Class("job-filters-summary-label").Text("Filters & sort"),
			app.If(j.activeFilterCount() > 0, func() app.UI {
				return app.Span().Class("job-filters-summary-count").Text(strconv.Itoa(j.activeFilterCount()))
			}),
		),
		j.renderFilterControls(),
		j.renderResetFilters(),
	)
}

// renderResetFilters renders a control that clears the score band, source,
// location, and date-range filters (plus the sort back to its default),
// without touching the scored/unscored view or lifecycle bin — those are
// separate tabs, not filters. Disabled when no filter is currently applied.
func (j *JobList) renderResetFilters() app.UI {
	return app.Button().
		Class("job-filters-reset").
		Type("button").
		Disabled(j.activeFilterCount() == 0).
		OnClick(j.resetFilters).
		Text("Reset filters")
}

func (j *JobList) resetFilters(ctx app.Context, _ app.Event) {
	if j.activeFilterCount() == 0 {
		return
	}
	j.applyResetFilters()
	j.load(ctx)
}

// applyResetFilters clears the filter selections back to their defaults.
// Split from the event handler so the state transition is unit-testable
// without the engine.
func (j *JobList) applyResetFilters() {
	j.scoreBand = ""
	j.source = ""
	j.location = ""
	j.dateFrom = ""
	j.dateTo = ""
	j.sort = jobSortOldest
	j.resetFeed()
}

// activeFilterCount counts the filter selections that differ from their default
// (sort is excluded — it always has a value), used to badge the collapsed panel.
func (j *JobList) activeFilterCount() int {
	n := 0
	for _, v := range []string{j.scoreBand, j.source, j.location, j.dateFrom, j.dateTo} {
		if v != "" {
			n++
		}
	}
	return n
}

func (j *JobList) renderFilterControls() app.UI {
	return app.Div().Class("job-filters").Body(
		app.Label().Class("job-filter").Body(
			app.Span().Text("Score"),
			app.Select().
				Class("job-filter-score-band").
				OnChange(j.setScoreBand).
				Body(
					scoreBandOption("", "All", j.scoreBand),
					scoreBandOption("high", "High (75+)", j.scoreBand),
					scoreBandOption("mid", "Mid (50–74)", j.scoreBand),
					scoreBandOption("low", "Low (<50)", j.scoreBand),
					scoreBandOption("unscored", "Unscored", j.scoreBand),
				),
		),
		app.Label().Class("job-filter").Body(
			app.Span().Text("Source"),
			app.Select().
				Class("job-filter-source").
				OnChange(j.setSource).
				Body(
					scoreBandOption("", "All", j.source),
					scoreBandOption("linkedin", "LinkedIn", j.source),
					scoreBandOption("glassdoor", "Glassdoor", j.source),
					scoreBandOption("indeed", "Indeed", j.source),
					scoreBandOption("manual", "Manual entry", j.source),
					scoreBandOption("inbound_llm", "Email alert", j.source),
				),
		),
		app.Label().Class("job-filter").Body(
			app.Span().Text("Location"),
			app.Input().
				Class("job-filter-location").
				Type("search").
				Placeholder("e.g. Vancouver").
				Value(j.location).
				OnChange(j.setLocation),
		),
		app.Label().Class("job-filter").Body(
			app.Span().Text("From"),
			app.Input().
				Class("job-filter-date-from").
				Type("date").
				Value(j.dateFrom).
				OnChange(j.setDateFrom),
		),
		app.Label().Class("job-filter").Body(
			app.Span().Text("To"),
			app.Input().
				Class("job-filter-date-to").
				Type("date").
				Value(j.dateTo).
				OnChange(j.setDateTo),
		),
		app.Label().Class("job-filter").Body(
			app.Span().Text("Sort"),
			app.Select().
				Class("job-filter-sort").
				OnChange(j.setSort).
				Body(
					scoreBandOption(jobSortOldest, "Oldest first", j.sort),
					scoreBandOption(jobSortScore, "Highest score", j.sort),
				),
		),
	)
}

// renderPagination renders Prev/Next controls and a page indicator reading the
// server's page envelope. Prev is disabled on page 1; Next is disabled when the
// envelope reports no further page.
func (j *JobList) renderPagination() app.UI {
	return app.Div().Class("job-pagination").Body(
		app.Button().
			Class("job-page-prev").
			Disabled(j.page.Number <= 1).
			OnClick(j.prevPage).
			Text("Previous"),
		app.Span().Class("job-page-indicator").Text(pageIndicatorLabel(j.page)),
		app.Button().
			Class("job-page-next").
			Disabled(!j.page.HasNext).
			OnClick(j.nextPage).
			Text("Next"),
	)
}

// allOption is the sentinel value carried by the "All" (no-filter) <option>.
// go-app omits an empty value attribute (renders `<option>All</option>`), and
// the browser then reports such an option's *text* as its value — so selecting
// "All" would send `source=All` to Rails and match nothing. Giving it a real
// value keeps the change handler reading a stable token, which optionValue maps
// back to the empty filter.
const allOption = "all"

// optionValue maps the allOption sentinel back to the empty filter; any other
// value passes through unchanged.
func optionValue(raw string) string {
	if raw == allOption {
		return ""
	}
	return raw
}

// scoreBandOption builds a <option> with selected set when value matches the
// current selection. Reused for the score-band, source, and sort selects. The
// empty (no-filter) value is rendered as the allOption sentinel so the browser
// never falls back to reporting the option text as its value.
func scoreBandOption(value, label, current string) app.UI {
	rendered := value
	if rendered == "" {
		rendered = allOption
	}
	opt := app.Option().Value(rendered).Text(label)
	if value == current {
		opt = opt.Selected(true)
	}
	return opt
}

// pageIndicatorLabel renders "Page N of M" from the page envelope, falling back
// to "Page N" when the total is unknown.
func pageIndicatorLabel(page PageMeta) string {
	number := page.Number
	if number < 1 {
		number = 1
	}
	if page.Size > 0 && page.Total > 0 {
		last := (page.Total + page.Size - 1) / page.Size
		return "Page " + strconv.Itoa(number) + " of " + strconv.Itoa(last)
	}
	return "Page " + strconv.Itoa(number)
}

func (j *JobList) renderJobRow(job JobSummary) app.UI {
	return app.Li().Class("job-list-item").Body(
		app.A().
			Class("job-list-link").
			Href("/jobs/"+strconv.Itoa(job.ID)).
			Body(
				app.Span().Class("job-title").Text(job.Title),
				app.Span().Class("job-company").Text(job.Company),
				app.If(SourceLabel(job.Source) != "", func() app.UI {
					return app.Span().Class("job-source").Body(
						sourceIcon(job.Source),
						app.Text(SourceLabel(job.Source)),
					)
				}),
				app.Div().Class("job-pills").Body(
					app.Span().
						Class("job-score").
						Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
						Text(MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
					lifecycleStatusPill(job.LifecycleState),
				),
			),
		// Manage bar: the selection checkbox sits with the lifecycle actions so
		// the controls that operate on a row are grouped together, not floating
		// above the card.
		app.Div().Class("job-list-actions").Body(
			app.Label().Class("job-select-label").Body(
				app.Input().
					Class("job-select").
					Type("checkbox").
					Checked(j.isSelected(job.ID)).
					Attr("aria-label", "Select "+job.Title).
					OnChange(j.toggleSelect(job.ID)),
				app.Span().Text("Select"),
			),
			app.If(j.view == jobListUnscored, func() app.UI {
				return j.renderScoreAction(job)
			}),
			j.renderLifecycleActions(job.ID),
		),
	)
}

// lifecycleStatusPill renders the small Active / Backlog / Removed status pill
// shown beside a job's match score, so a card's intake state is visible at a
// glance (most useful on the mixed ingestion landing, where rows aren't
// pre-filtered by bin).
func lifecycleStatusPill(state string) app.UI {
	s := state
	if s == "" {
		s = jobStateActive
	}
	return app.Span().
		Class("job-status").
		Class("job-status--" + s).
		Text(LifecycleLabel(state))
}

// renderLifecycleActions renders the per-row intake controls for a job. In the
// Active bin a row exposes Backlog + Remove; in the Backlog/Removed bins it
// exposes Restore (back to active). Each is an explicit click; no lifecycle
// mutation fires on render.
func (j *JobList) renderLifecycleActions(id int) app.UI {
	return app.Div().Class("job-lifecycle-actions").Body(
		app.If(j.bin != jobStateActive, func() app.UI {
			return app.Button().
				Class("job-lifecycle-restore").
				Disabled(j.lifecycleBusy).
				OnClick(j.setLifecycle([]int{id}, jobStateActive)).
				Text("Restore")
		}).ElseIf(true, func() app.UI {
			return app.Div().Body(
				app.Button().
					Class("job-lifecycle-backlog").
					Disabled(j.lifecycleBusy).
					OnClick(j.setLifecycle([]int{id}, jobStateBacklog)).
					Text("Backlog"),
				app.Button().
					Class("job-lifecycle-remove").
					Disabled(j.lifecycleBusy).
					OnClick(j.setLifecycle([]int{id}, jobStateRemoved)).
					Text("Remove"),
			)
		}),
	)
}

// renderBulkActions renders the multi-select bulk controls: in the Active bin
// Backlog + Remove for the checked rows, and in the Backlog/Removed bins a
// Restore. Disabled when nothing is selected or a transition is in flight.
func (j *JobList) renderBulkActions() app.UI {
	count := j.selectedCount()
	return app.Div().Class("job-bulk-actions").Body(
		app.Span().Class("job-bulk-count").Text(bulkSelectionLabel(count)),
		app.If(j.bin != jobStateActive, func() app.UI {
			return app.Button().
				Class("job-bulk-restore").
				Disabled(count == 0 || j.lifecycleBusy).
				OnClick(j.bulkLifecycle(jobStateActive)).
				Text("Restore selected")
		}).ElseIf(true, func() app.UI {
			return app.Div().Body(
				app.Button().
					Class("job-bulk-backlog").
					Disabled(count == 0 || j.lifecycleBusy).
					OnClick(j.bulkLifecycle(jobStateBacklog)).
					Text("Backlog selected"),
				app.Button().
					Class("job-bulk-remove").
					Disabled(count == 0 || j.lifecycleBusy).
					OnClick(j.bulkLifecycle(jobStateRemoved)).
					Text("Remove selected"),
			)
		}),
		app.If(j.lifecycleErr != "", func() app.UI {
			return app.P().Class("job-lifecycle-error").Text(j.lifecycleErr)
		}),
	)
}

func bulkSelectionLabel(n int) string {
	if n == 1 {
		return "1 selected"
	}
	return strconv.Itoa(n) + " selected"
}

func (j *JobList) renderScoreAction(job JobSummary) app.UI {
	state := j.scoreState(job.ID)
	return app.Div().Class("job-list-score-action").Body(
		app.Button().
			Class("job-list-score-button").
			Disabled(state == scoreRequesting || job.ScoringStatus == "pending").
			OnClick(j.scoreJob(job.ID)).
			Text(scoreButtonLabel(state, job.ScoringStatus)),
		app.If(j.scoreErr(job.ID) != "", func() app.UI {
			return app.P().Class("job-list-score-error").Text(j.scoreErr(job.ID))
		}),
	)
}

func (j *JobList) showView(view string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if j.view == view {
			return
		}
		j.applyView(view)
		j.load(ctx)
	}
}

// applyView records a status-toggle change and resets paging. Split from the
// event handler so the state transition is unit-testable without the engine.
func (j *JobList) applyView(view string) {
	j.view = view
	j.resetFeed()
}

func (j *JobList) showBin(state string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if j.bin == state {
			return
		}
		j.applyBin(state)
		j.load(ctx)
	}
}

func (j *JobList) applyBin(state string) {
	j.bin = state
	j.resetFeed()
}

// filter setters read the new value from the changed control, store it, reset to
// page 1, and refetch. Each is split into an apply* helper for engine-free tests.
func (j *JobList) setScoreBand(ctx app.Context, _ app.Event) {
	j.applyScoreBand(optionValue(ctx.JSSrc().Get("value").String()))
	j.load(ctx)
}

func (j *JobList) applyScoreBand(value string) { j.scoreBand = value; j.resetFeed() }

func (j *JobList) setSource(ctx app.Context, _ app.Event) {
	j.applySource(optionValue(ctx.JSSrc().Get("value").String()))
	j.load(ctx)
}

func (j *JobList) applySource(value string) { j.source = value; j.resetFeed() }

func (j *JobList) setLocation(ctx app.Context, _ app.Event) {
	j.applyLocation(ctx.JSSrc().Get("value").String())
	j.load(ctx)
}

func (j *JobList) applyLocation(value string) { j.location = value; j.resetFeed() }

func (j *JobList) setDateFrom(ctx app.Context, _ app.Event) {
	j.applyDateFrom(ctx.JSSrc().Get("value").String())
	j.load(ctx)
}

func (j *JobList) applyDateFrom(value string) { j.dateFrom = value; j.resetFeed() }

func (j *JobList) setDateTo(ctx app.Context, _ app.Event) {
	j.applyDateTo(ctx.JSSrc().Get("value").String())
	j.load(ctx)
}

func (j *JobList) applyDateTo(value string) { j.dateTo = value; j.resetFeed() }

func (j *JobList) setSort(ctx app.Context, _ app.Event) {
	j.applySort(ctx.JSSrc().Get("value").String())
	j.load(ctx)
}

func (j *JobList) applySort(value string) { j.sort = value; j.resetFeed() }

// resetFeed clears the current rows/error and returns to page 1 — used whenever
// a filter/bin/sort/status selection changes so the new query starts fresh.
func (j *JobList) resetFeed() {
	j.jobs = nil
	j.err = ""
	j.pageNum = 1
}

func (j *JobList) prevPage(ctx app.Context, _ app.Event) {
	if j.applyPrevPage() {
		j.load(ctx)
	}
}

// applyPrevPage steps back one page when not already on the first, returning
// true when a refetch is warranted.
func (j *JobList) applyPrevPage() bool {
	if j.pageNum <= 1 {
		return false
	}
	j.pageNum--
	return true
}

func (j *JobList) nextPage(ctx app.Context, _ app.Event) {
	if j.applyNextPage() {
		j.load(ctx)
	}
}

// applyNextPage advances one page when the envelope reports a next page exists,
// returning true when a refetch is warranted.
func (j *JobList) applyNextPage() bool {
	if !j.page.HasNext {
		return false
	}
	if j.pageNum < 1 {
		j.pageNum = 1
	}
	j.pageNum++
	return true
}

// --- lifecycle (backlog/remove/restore) actions ---

func (j *JobList) isSelected(id int) bool {
	return j.selected[id]
}

func (j *JobList) selectedCount() int {
	n := 0
	for _, on := range j.selected {
		if on {
			n++
		}
	}
	return n
}

// selectedIDs returns the currently-checked ids that are still present in the
// loaded rows, in row order, so a bulk action targets exactly the visible
// selection.
func (j *JobList) selectedIDs() []int {
	var ids []int
	for i := range j.jobs {
		if j.selected[j.jobs[i].ID] {
			ids = append(ids, j.jobs[i].ID)
		}
	}
	return ids
}

func (j *JobList) toggleSelect(id int) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		j.applyToggleSelect(id)
		ctx.Update()
	}
}

// applyToggleSelect flips a row's selection. Split from the handler so the
// selection transition is unit-testable without the engine.
func (j *JobList) applyToggleSelect(id int) {
	if j.selected == nil {
		j.selected = map[int]bool{}
	}
	j.selected[id] = !j.selected[id]
}

// setLifecycle returns a click handler that transitions the given ids to the
// target lifecycle state. Used for both the per-row (single id) and bulk
// (selected ids) controls.
func (j *JobList) setLifecycle(ids []int, state string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if j.lifecycleBusy || len(ids) == 0 {
			return
		}
		j.lifecycleBusy = true
		j.lifecycleErr = ""
		ctx.Update()
		reqCtx := ctx.Context
		ctx.Async(func() {
			updated, err := j.Client.SetJobLifecycle(reqCtx, ids, state)
			ctx.Dispatch(func(ctx app.Context) {
				j.applyLifecycleResult(ids, state, updated, err)
				ctx.Update()
			})
		})
	}
}

func (j *JobList) bulkLifecycle(state string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		j.setLifecycle(j.selectedIDs(), state)(ctx, app.Event{})
	}
}

// doSetLifecycle performs the lifecycle call and applies the result
// synchronously. It is the body invoked inside the async click handler; tests
// drive it directly to exercise the path without the go-app engine.
func (j *JobList) doSetLifecycle(ctx context.Context, ids []int, state string) {
	if len(ids) == 0 {
		return
	}
	j.lifecycleBusy = true
	updated, err := j.Client.SetJobLifecycle(ctx, ids, state)
	j.applyLifecycleResult(ids, state, updated, err)
}

// applyLifecycleResult records the outcome of a lifecycle transition. On
// success the transitioned rows leave the current bin view (their target bin
// differs from the bin being shown) and their selection is cleared. Split out
// from the app.Context plumbing so the state transition is unit-testable
// without the go-app engine.
func (j *JobList) applyLifecycleResult(ids []int, state string, _ []JobSummary, err error) {
	j.lifecycleBusy = false
	if err != nil {
		if IsUnauthorized(err) {
			j.lifecycleErr = sessionExpiredMessage
		} else {
			j.lifecycleErr = "Could not update the job. Please try again."
		}
		return
	}
	j.lifecycleErr = ""
	gone := map[int]bool{}
	for _, id := range ids {
		gone[id] = true
		delete(j.selected, id)
	}
	// A transition moves a row to a different bin, so it leaves the current
	// view. (state == j.bin can't happen for these controls, but guard anyway.)
	if state != j.bin {
		filtered := j.jobs[:0]
		for i := range j.jobs {
			if !gone[j.jobs[i].ID] {
				filtered = append(filtered, j.jobs[i])
			}
		}
		j.jobs = filtered
	}
}

func (j *JobList) scoreJob(id int) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if j.scoreState(id) == scoreRequesting {
			return
		}
		j.setScoreState(id, scoreRequesting, "")
		ctx.Update()
		reqCtx := ctx.Context
		ctx.Async(func() {
			job, err := j.Client.ScoreJobPost(reqCtx, id)
			ctx.Dispatch(func(ctx app.Context) {
				j.applyScoreResult(id, job, err)
				ctx.Update()
			})
		})
	}
}

func (j *JobList) doScoreJob(ctx context.Context, id int) {
	j.setScoreState(id, scoreRequesting, "")
	job, err := j.Client.ScoreJobPost(ctx, id)
	j.applyScoreResult(id, job, err)
}

func (j *JobList) applyScoreResult(id int, job JobSummary, err error) {
	if err != nil {
		msg := "Could not request scoring."
		if IsUnauthorized(err) {
			msg = sessionExpiredMessage
		}
		j.setScoreState(id, scoreRequestError, msg)
		return
	}
	for i := range j.jobs {
		if j.jobs[i].ID == id {
			j.jobs[i] = job
			break
		}
	}
	j.setScoreState(id, scoreIdle, "")
}

func (j *JobList) scoreState(id int) scoreRequestState {
	if j.scoreStates == nil {
		return scoreIdle
	}
	return j.scoreStates[id]
}

func (j *JobList) scoreErr(id int) string {
	if j.scoreErrs == nil {
		return ""
	}
	return j.scoreErrs[id]
}

func (j *JobList) setScoreState(id int, state scoreRequestState, err string) {
	if j.scoreStates == nil {
		j.scoreStates = map[int]scoreRequestState{}
	}
	if j.scoreErrs == nil {
		j.scoreErrs = map[int]string{}
	}
	j.scoreStates[id] = state
	if err == "" {
		delete(j.scoreErrs, id)
	} else {
		j.scoreErrs[id] = err
	}
}

func (j *JobList) emptyText() string {
	switch j.bin {
	case jobStateBacklog:
		return "No jobs in the backlog."
	case jobStateRemoved:
		return "No removed jobs."
	}
	if j.view == jobListUnscored {
		return "No unscored jobs."
	}
	return "No scored jobs yet."
}

func scoreButtonLabel(state scoreRequestState, scoringStatus string) string {
	if state == scoreRequesting {
		return "Scoring..."
	}
	if scoringStatus == "pending" {
		return "Queued"
	}
	return "Score"
}

// JobDetailView renders the full scored view of a single job: summary, match
// score, relevant/missing requirements, red flags, alignment notes, and the
// resolved application route (GET /api/job_posts/:id).
type JobDetailView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock.
	Client RailsClient
	// JobID is the job to render; normally parsed from the route path.
	JobID int
	// backHref is where the "back" link returns to. It defaults to the jobs
	// feed but is set to the expanded ingestion batch when the user arrived
	// from the digest landing (via the ?from=digest&batch=… query params).
	backHref string
	// backLabel is the text of the back link, matching backHref's destination.
	backLabel string

	state loadState
	job   JobDetail
	err   string

	applyState applyStatus
	applyErr   string

	statusSaving bool
	statusErr    string

	lifecycleBusy bool
	lifecycleErr  string
}

// applyStatus tracks the explicit "start application" action, separate from the
// job fetch (loadState). It never fires on mount: it advances out of applyIdle
// only on an explicit user click of the apply button.
type applyStatus int

const (
	applyIdle applyStatus = iota
	applyCreating
	applyError
)

func (d *JobDetailView) OnMount(ctx app.Context)     { d.start(ctx) }
func (d *JobDetailView) OnPreRender(ctx app.Context) { d.start(ctx) }

func (d *JobDetailView) start(ctx app.Context) {
	if d.Client == nil {
		d.Client = NewRailsClient()
	}
	if id, ok := jobIDFromPath(ctx.Page().URL().Path); ok {
		d.JobID = id
	}
	d.resolveBack(ctx.Page().URL())
	d.load(ctx)
}

// OnNav re-fetches when the route changes to a different job id while the
// component instance is reused.
func (d *JobDetailView) OnNav(ctx app.Context) {
	d.resolveBack(ctx.Page().URL())
	if id, ok := jobIDFromPath(ctx.Page().URL().Path); ok && id != d.JobID {
		d.JobID = id
		d.load(ctx)
	}
}

// resolveBack sets the back link target from the request URL. When the user
// arrived from the ingestion landing (?from=digest), back returns to that
// screen with the originating batch re-expanded (?batch=…); otherwise it
// falls back to the jobs feed.
func (d *JobDetailView) resolveBack(u *url.URL) {
	d.backHref = "/jobs"
	d.backLabel = "← Jobs"
	if u == nil {
		return
	}
	q := u.Query()
	if q.Get("from") != "digest" {
		return
	}
	d.backLabel = "← Ingestions"
	if batch := q.Get("batch"); batch != "" {
		d.backHref = "/?batch=" + url.QueryEscape(batch)
	} else {
		d.backHref = "/"
	}
}

func (d *JobDetailView) load(ctx app.Context) {
	d.state = loadLoading
	ctx.Update()
	id := d.JobID
	reqCtx := ctx.Context
	ctx.Async(func() {
		job, err := d.Client.Job(reqCtx, id)
		ctx.Dispatch(func(ctx app.Context) {
			applyResult(ctx, &d.state, &d.err, err, func() { d.job = job })
		})
	})
}

// apply is the explicit user action that starts an application for this job: it
// asks Rails to create (or reuse) an Application and generate a draft, then
// navigates to the draft-review screen where the user approves and submits. It
// runs only on an explicit click — the screen never starts an application on
// mount or render.
func (d *JobDetailView) apply(ctx app.Context, _ app.Event) {
	if d.applyState == applyCreating {
		return
	}
	d.applyState = applyCreating
	d.applyErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	id := d.JobID
	ctx.Async(func() {
		res, err := d.Client.CreateApplication(reqCtx, id)
		ctx.Dispatch(func(ctx app.Context) {
			if appID, ok := d.applyCreateResult(res, err); ok {
				ctx.Navigate("/applications/" + strconv.Itoa(appID))
				return
			}
			ctx.Update()
		})
	})
}

// doApply performs the create-application call and applies the result
// synchronously. It is the body invoked inside the async click handler; tests
// drive it directly to exercise the path without the go-app engine.
func (d *JobDetailView) doApply(ctx context.Context) (int, bool) {
	d.applyState = applyCreating
	res, err := d.Client.CreateApplication(ctx, d.JobID)
	return d.applyCreateResult(res, err)
}

// applyCreateResult records the outcome of an apply attempt. It returns the new
// application id and ok=true when the caller should navigate to the review
// screen. Split out from the app.Context plumbing so the state transition is
// unit-testable without the go-app engine.
func (d *JobDetailView) applyCreateResult(res CreateApplicationResult, err error) (int, bool) {
	if err != nil {
		d.applyState = applyError
		if IsUnauthorized(err) {
			d.applyErr = sessionExpiredMessage
		} else {
			d.applyErr = "Could not start the application. Please try again."
		}
		return 0, false
	}
	d.applyState = applyIdle
	return res.ApplicationID, true
}

// backFallback returns the resolved back href, defaulting to the jobs feed when
// resolveBack has not run (e.g. a directly-constructed test component).
func (d *JobDetailView) backFallback() string {
	if d.backHref == "" {
		return "/jobs"
	}
	return d.backHref
}

// backFallbackLabel mirrors backFallback for the link text.
func (d *JobDetailView) backFallbackLabel() string {
	if d.backLabel == "" {
		return "← Jobs"
	}
	return d.backLabel
}

func (d *JobDetailView) Render() app.UI {
	return app.Div().Class("job-detail").Body(
		app.A().Class("job-detail-back").Href(d.backFallback()).Text(d.backFallbackLabel()),
		renderLoad(d.state, d.err, func() app.UI {
			job := d.job
			return app.Div().Class("job-detail-body").Body(
				app.H1().Class("job-title").Text(job.Title),
				app.P().Class("job-company").Text(job.Company),
				app.If(SourceLabel(job.Source) != "", func() app.UI {
					return app.P().Class("job-source").Body(
						sourceIcon(job.Source),
						app.Text("Source: "+SourceLabel(job.Source)),
					)
				}),
				app.If(job.Compensation != "", func() app.UI {
					return app.P().Class("job-compensation").Text(job.Compensation)
				}),
				app.P().
					Class("job-score").
					Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
					Text("Match: "+MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
				app.If(job.Summary != "", func() app.UI {
					return app.P().Class("job-summary").Text(job.Summary)
				}),
				requirementList("Relevant requirements", "job-relevant", job.RelevantRequirements),
				requirementList("Missing requirements", "job-missing", job.MissingRequirements),
				requirementList("Red flags", "job-red-flags", job.RedFlags),
				app.If(job.ResumeAlignment != "", func() app.UI {
					return app.P().Class("job-alignment").Text(job.ResumeAlignment)
				}),
				app.If(job.ApplicationStrategy != "", func() app.UI {
					return app.P().Class("job-strategy").Text(job.ApplicationStrategy)
				}),
				renderRoute(job.Route),
				d.renderPipelineStatus(job.Application),
				d.renderLifecycle(job.LifecycleState),
				d.renderApply(),
				app.A().
					Class("job-contacts-link").
					Href("/jobs/"+strconv.Itoa(job.ID)+"/contacts").
					Text("View contacts and outreach"),
			)
		}),
	)
}

func (d *JobDetailView) renderPipelineStatus(application *ApplicationTracker) app.UI {
	status := "interested"
	stage := ""
	if application != nil {
		status = application.PipelineStatus
		stage = application.PipelineStage
	}
	return app.Div().Class("job-pipeline-status").Body(
		app.H2().Text("Application status"),
		app.Label().Class("pipeline-select-label").Body(
			app.Span().Text("Status"),
			app.Select().
				Class("pipeline-status-select").
				OnChange(d.jobStatusSetter(stage)).
				Body(pipelineStatusOptions(status)...),
		),
		app.Label().Class("pipeline-select-label").Body(
			app.Span().Text("Stage"),
			app.Select().
				Class("pipeline-stage-select").
				OnChange(d.jobStageSetter(status)).
				Body(pipelineStageOptions(stage)...),
		),
		app.If(d.statusSaving, func() app.UI {
			return app.P().Class("job-pipeline-saving").Text("Saving…")
		}),
		app.If(d.statusErr != "", func() app.UI {
			return app.P().Class("job-pipeline-error").Text(d.statusErr)
		}),
	)
}

func (d *JobDetailView) jobStatusSetter(_ string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		next := ctx.JSSrc().Get("value").String()
		d.saveJobPipelineStatus(ctx, ApplicationStatusUpdate{PipelineStatus: next})
	}
}

func (d *JobDetailView) jobStageSetter(status string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		next := ctx.JSSrc().Get("value").String()
		if status == "" {
			status = "interested"
		}
		d.saveJobPipelineStatus(ctx, ApplicationStatusUpdate{PipelineStatus: status, PipelineStage: next})
	}
}

func (d *JobDetailView) saveJobPipelineStatus(ctx app.Context, update ApplicationStatusUpdate) {
	if d.statusSaving {
		return
	}
	d.statusSaving = true
	d.statusErr = ""
	ctx.Update()
	reqCtx := ctx.Context
	id := d.JobID
	ctx.Async(func() {
		application, err := d.Client.UpdateJobApplicationStatus(reqCtx, id, update)
		ctx.Dispatch(func(ctx app.Context) {
			d.applyJobStatusResult(application, err)
			ctx.Update()
		})
	})
}

func (d *JobDetailView) doJobStatusUpdate(ctx context.Context, update ApplicationStatusUpdate) {
	d.statusSaving = true
	application, err := d.Client.UpdateJobApplicationStatus(ctx, d.JobID, update)
	d.applyJobStatusResult(application, err)
}

func (d *JobDetailView) applyJobStatusResult(application ApplicationTracker, err error) {
	d.statusSaving = false
	if err != nil {
		if IsUnauthorized(err) {
			d.statusErr = sessionExpiredMessage
		} else {
			d.statusErr = "Could not update application status."
		}
		return
	}
	d.job.Application = &application
	d.statusErr = ""
}

// renderLifecycle renders the job-detail intake controls. When the job is
// active it offers Backlog + Remove; when it is in the Backlog/Removed bin it
// offers Restore (back to active). Each is an explicit click; the screen never
// mutates lifecycle state on mount/render.
func (d *JobDetailView) renderLifecycle(state string) app.UI {
	if state == "" {
		state = jobStateActive
	}
	return app.Div().Class("job-lifecycle").Body(
		app.H2().Text("Intake"),
		app.If(state != jobStateActive, func() app.UI {
			return app.Button().
				Class("job-lifecycle-restore").
				Disabled(d.lifecycleBusy).
				OnClick(d.setLifecycle(jobStateActive)).
				Text("Restore to active")
		}).ElseIf(true, func() app.UI {
			return app.Div().Class("job-lifecycle-buttons").Body(
				app.Button().
					Class("job-lifecycle-backlog").
					Disabled(d.lifecycleBusy).
					OnClick(d.setLifecycle(jobStateBacklog)).
					Text("Move to backlog"),
				app.Button().
					Class("job-lifecycle-remove").
					Disabled(d.lifecycleBusy).
					OnClick(d.setLifecycle(jobStateRemoved)).
					Text("Remove"),
			)
		}),
		app.If(d.lifecycleErr != "", func() app.UI {
			return app.P().Class("job-lifecycle-error").Text(d.lifecycleErr)
		}),
	)
}

func (d *JobDetailView) setLifecycle(state string) app.EventHandler {
	return func(ctx app.Context, _ app.Event) {
		if d.lifecycleBusy {
			return
		}
		d.lifecycleBusy = true
		d.lifecycleErr = ""
		ctx.Update()
		reqCtx := ctx.Context
		id := d.JobID
		ctx.Async(func() {
			updated, err := d.Client.SetJobLifecycle(reqCtx, []int{id}, state)
			ctx.Dispatch(func(ctx app.Context) {
				d.applyLifecycleResult(state, updated, err)
				ctx.Update()
			})
		})
	}
}

// doSetLifecycle performs the lifecycle call and applies the result
// synchronously. Tests drive it directly to exercise the path without the
// go-app engine.
func (d *JobDetailView) doSetLifecycle(ctx context.Context, state string) {
	d.lifecycleBusy = true
	updated, err := d.Client.SetJobLifecycle(ctx, []int{d.JobID}, state)
	d.applyLifecycleResult(state, updated, err)
}

// applyLifecycleResult records the outcome of a detail lifecycle transition,
// updating the local job's lifecycle_state on success so the controls reflect
// the new bin (Restore vs Backlog/Remove). Split out for engine-free tests.
func (d *JobDetailView) applyLifecycleResult(state string, updated []JobSummary, err error) {
	d.lifecycleBusy = false
	if err != nil {
		if IsUnauthorized(err) {
			d.lifecycleErr = sessionExpiredMessage
		} else {
			d.lifecycleErr = "Could not update the job. Please try again."
		}
		return
	}
	d.lifecycleErr = ""
	if len(updated) > 0 {
		d.job.LifecycleState = updated[0].LifecycleState
	} else {
		d.job.LifecycleState = state
	}
}

// renderApply shows the explicit "start application" control: it prepares a
// tailored draft (and, for supported ATS targets, the trusted auto-submit
// payload) for review before the user approves and submits on the next screen.
// The button is the only path that starts an application.
func (d *JobDetailView) renderApply() app.UI {
	return app.Div().Class("job-apply").Body(
		app.Button().
			Class("job-apply-button").
			Disabled(d.applyState == applyCreating).
			OnClick(d.apply).
			Text(applyButtonLabel(d.applyState)),
		app.P().Class("job-apply-note").
			Text("Generates a tailored draft to review before you approve and submit."),
		app.If(d.applyState == applyError, func() app.UI {
			return app.P().Class("job-apply-error").Text(d.applyErr)
		}),
	)
}

func applyButtonLabel(s applyStatus) string {
	if s == applyCreating {
		return "Preparing…"
	}
	return "Apply"
}

// DigestView renders the ingestion-history landing: recently-ingested postings
// grouped into batches (one alert/digest email per batch), grouped by date and
// newest first (GET /api/ingestion_batches). Each batch is a collapsible
// <details> block; expanding it reveals its individual postings, each linking
// to the job detail. This replaces the old top-5-scored "daily digest" list so
// the screen reflects every ingestion as it arrives, not just yesterday's best.
type DigestView struct {
	app.Compo

	// Client is the Rails client; tests inject a mock.
	Client RailsClient

	state         loadState
	batches       []IngestionBatch
	page          PageMeta
	err           string
	intake        IntakeStatus
	intakeBusy    bool
	intakeErr     string
	intakeMessage string
	// pageNum is the current 1-based page; Prev/Next advance it without losing
	// the open-batch target.
	pageNum int
	// openBatch is the id of the batch to render expanded on load, set from the
	// ?batch=… query param so returning from a job detail re-opens its batch.
	openBatch string
}

func (v *DigestView) OnMount(ctx app.Context) {
	v.ensureClient()
	v.openBatch = ctx.Page().URL().Query().Get("batch")
	v.load(ctx)
}

func (v *DigestView) OnPreRender(ctx app.Context) {
	v.ensureClient()
	v.openBatch = ctx.Page().URL().Query().Get("batch")
	v.load(ctx)
}

// OnNav re-reads the open-batch target when navigating back to the landing
// (e.g. via the job-detail back link) so the originating batch re-expands.
func (v *DigestView) OnNav(ctx app.Context) {
	v.openBatch = ctx.Page().URL().Query().Get("batch")
	ctx.Update()
}

func (v *DigestView) ensureClient() {
	if v.Client == nil {
		v.Client = NewRailsClient()
	}
}

func (v *DigestView) load(ctx app.Context) {
	if v.pageNum < 1 {
		v.pageNum = 1
	}
	v.state = loadLoading
	ctx.Update()
	reqCtx := ctx.Context
	page := v.pageNum
	ctx.Async(func() {
		intake, intakeErr := v.Client.Intake(reqCtx)
		res, err := v.Client.IngestionBatches(reqCtx, page)
		ctx.Dispatch(func(ctx app.Context) {
			if intakeErr != nil {
				err = intakeErr
			}
			applyResult(ctx, &v.state, &v.err, err, func() {
				v.intake = intake
				v.batches = res.Batches
				v.page = res.Page
			})
		})
	})
}

func (v *DigestView) toggleIntake(ctx app.Context, _ app.Event) {
	if v.intakeBusy {
		return
	}
	v.intakeBusy = true
	v.intakeErr = ""
	v.intakeMessage = ""
	target := !v.intake.Enabled
	reqCtx := ctx.Context
	ctx.Update()
	ctx.Async(func() {
		status, err := v.Client.SetIntake(reqCtx, target)
		ctx.Dispatch(func(ctx app.Context) {
			v.applyIntakeResult(status, err)
			ctx.Update()
		})
	})
}

// doSetIntake and applyIntakeResult keep the explicit owner action testable
// without a browser context; rendering never changes intake on its own.
func (v *DigestView) doSetIntake(ctx context.Context, enabled bool) {
	v.intakeBusy = true
	status, err := v.Client.SetIntake(ctx, enabled)
	v.applyIntakeResult(status, err)
}

func (v *DigestView) applyIntakeResult(status IntakeStatus, err error) {
	v.intakeBusy = false
	if err != nil {
		v.intakeErr = "Could not update intake. Please try again."
		v.intakeMessage = ""
		return
	}
	v.intake = status
	v.intakeErr = ""
	if status.Enabled {
		if status.QueuedCount > 0 {
			v.intakeMessage = fmt.Sprintf("Intake resumed. Processing %d held alerts.", status.QueuedCount)
		} else {
			v.intakeMessage = "Intake resumed."
		}
	} else {
		v.intakeMessage = "Intake paused. New alerts will be held for later."
	}
}

func (v *DigestView) renderIntakeControl() app.UI {
	statusClass := "intake-status intake-status--paused"
	statusText := "Paused"
	buttonText := "Resume intake"
	if v.intake.Enabled {
		statusClass = "intake-status intake-status--on"
		statusText = "Running"
		buttonText = "Pause intake"
	}
	if v.intakeBusy {
		buttonText = "Updating…"
	}

	return app.Section().Class("intake-control").Body(
		app.Div().Class("intake-control-heading").Body(
			app.Div().Body(
				app.H2().Text("Job alert intake"),
				app.P().Class("intake-control-note").Text("Pause new parsing and scoring while keeping saved jobs available."),
			),
			app.Span().Class(statusClass).Text(statusText),
		),
		app.If(v.intake.HeldCount > 0, func() app.UI {
			return app.P().Class("intake-held-count").Text(fmt.Sprintf("%d alerts held for later.", v.intake.HeldCount))
		}),
		app.Button().
			Class("intake-toggle").
			Disabled(v.intakeBusy).
			OnClick(v.toggleIntake).
			Text(buttonText),
		app.If(v.intakeErr != "", func() app.UI {
			return app.P().Class("intake-error").Text(v.intakeErr)
		}),
		app.If(v.intakeMessage != "", func() app.UI {
			return app.P().Class("intake-message").Text(v.intakeMessage)
		}),
	)
}

func (v *DigestView) prevPage(ctx app.Context, _ app.Event) {
	if v.applyPrevPage() {
		v.load(ctx)
	}
}

// applyPrevPage steps back one page when not already on the first, returning
// true when a refetch is warranted.
func (v *DigestView) applyPrevPage() bool {
	if v.pageNum <= 1 {
		return false
	}
	v.pageNum--
	return true
}

func (v *DigestView) nextPage(ctx app.Context, _ app.Event) {
	if v.applyNextPage() {
		v.load(ctx)
	}
}

// applyNextPage advances one page when the envelope reports a next page exists,
// returning true when a refetch is warranted.
func (v *DigestView) applyNextPage() bool {
	if !v.page.HasNext {
		return false
	}
	if v.pageNum < 1 {
		v.pageNum = 1
	}
	v.pageNum++
	return true
}

// renderPagination renders Prev/Next controls and a page indicator reading the
// server's page envelope. Prev is disabled on page 1; Next is disabled when the
// envelope reports no further page.
func (v *DigestView) renderPagination() app.UI {
	return app.Div().Class("digest-pagination").Body(
		app.Button().
			Class("digest-page-prev").
			Disabled(v.page.Number <= 1).
			OnClick(v.prevPage).
			Text("Previous"),
		app.Span().Class("digest-page-indicator").Text(pageIndicatorLabel(v.page)),
		app.Button().
			Class("digest-page-next").
			Disabled(!v.page.HasNext).
			OnClick(v.nextPage).
			Text("Next"),
	)
}

func (v *DigestView) Render() app.UI {
	return app.Div().Class("digest").Body(
		renderAppTabs("digest"),
		app.H1().Text("Recent ingestions"),
		renderLoad(v.state, v.err, func() app.UI {
			return app.Div().Class("digest-content").Body(
				v.renderIntakeControl(),
				v.renderBatches(),
			)
		}),
	)
}

// renderBatches groups the (newest-first) batches by date, emitting a date
// header each time the date changes, then the batch cards for that date.
func (v *DigestView) renderBatches() app.UI {
	if len(v.batches) == 0 {
		return app.P().Class("digest-empty").Text("No ingestions yet.")
	}

	var lastDate string
	return app.Div().Class("digest-body").Body(
		app.Range(v.batches).Slice(func(i int) app.UI {
			batch := v.batches[i]
			showHeader := batch.Date != lastDate
			lastDate = batch.Date
			return app.Div().Class("digest-batch-group").Body(
				app.If(showHeader, func() app.UI {
					return app.P().Class("digest-date").Text(formatBatchDate(batch.Date))
				}),
				renderBatch(batch, batch.ID == v.openBatch),
			)
		}),
		v.renderPagination(),
	)
}

// renderBatch renders one ingestion batch as a collapsible block: a summary row
// (source + count + time) the user clicks to reveal the batch's postings. When
// open is true the block renders expanded — used to re-open the batch a user
// returns to from a job detail.
func renderBatch(batch IngestionBatch, open bool) app.UI {
	details := app.Details().Class("digest-batch")
	if open {
		// Only set the boolean attribute when expanding: go-app renders
		// .Open(false) as open="false", which a browser still treats as open.
		details = details.Open(true)
	}
	return details.Body(
		app.Summary().Class("digest-batch-summary").Body(
			app.Span().Class("job-source").Body(
				sourceIcon(batch.Source),
				app.Text(batchSourceLabel(batch.Source)),
			),
			app.Span().Class("digest-batch-count").Text(batchCountLabel(batch.Count)),
			app.If(formatBatchTime(batch.IngestedAt) != "", func() app.UI {
				return app.Span().Class("digest-batch-time").Text(formatBatchTime(batch.IngestedAt))
			}),
		),
		app.Ul().Class("digest-items").Body(
			app.Range(batch.Jobs).Slice(func(i int) app.UI {
				job := batch.Jobs[i]
				return app.Li().Class("digest-item").Body(
					app.A().
						Class("digest-link").
						Href("/jobs/"+strconv.Itoa(job.ID)+"?from=digest&batch="+url.QueryEscape(batch.ID)).
						Body(
							app.Span().Class("job-title").Text(job.Title),
							app.Span().Class("job-company").Text(job.Company),
							app.Div().Class("job-pills").Body(
								app.Span().
									Class("job-score").
									Class("job-score--"+MatchScoreBand(job.MatchScore, job.ScoringStatus)).
									Text(MatchScoreLabel(job.MatchScore, job.ScoringStatus)),
								lifecycleStatusPill(job.LifecycleState),
							),
						),
				)
			}),
		),
	)
}

// --- shared render helpers ---

// sourceIcon renders the origin marker shown before a source label: the
// official brand logo (self-hosted SVG) for branded sources, an emoji for
// non-branded ones (manual/email), or nothing when neither applies.
func sourceIcon(source string) app.UI {
	if path := SourceIconPath(source); path != "" {
		return app.Img().
			Class("job-source-logo").
			Src(path).
			Alt(SourceLabel(source)).
			Attr("loading", "lazy")
	}
	if e := SourceEmoji(source); e != "" {
		return app.Span().Class("job-source-emoji").Text(e)
	}
	return app.Text("")
}

// batchSourceLabel is the source label for a batch summary, falling back to a
// neutral word when the source is unknown so the row is never blank.
func batchSourceLabel(source string) string {
	if label := SourceLabel(source); label != "" {
		return label
	}
	return "Other"
}

// batchCountLabel renders the posting count for a batch summary.
func batchCountLabel(n int) string {
	if n == 1 {
		return "1 job"
	}
	return strconv.Itoa(n) + " jobs"
}

// formatBatchDate renders an ISO date (YYYY-MM-DD) as a friendlier "Mon 2"
// header; on parse failure it returns the raw value rather than nothing.
func formatBatchDate(iso string) string {
	t, err := time.Parse("2006-01-02", iso)
	if err != nil {
		return iso
	}
	return t.Format("Mon, Jan 2")
}

// formatBatchTime renders an RFC3339 timestamp as a short local time of day
// ("3:04 PM"); it returns "" when the value is empty or unparseable so the
// caller can omit the chip.
func formatBatchTime(ts string) string {
	if ts == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil {
		return ""
	}
	return t.Format("3:04 PM")
}

// applyResult updates the shared load state from an async fetch result. On a
// 401 it leaves an auth-specific error so the caller could route to login.
func applyResult(ctx app.Context, state *loadState, errMsg *string, err error, set func()) {
	if err != nil {
		*state = loadError
		if IsUnauthorized(err) {
			*errMsg = sessionExpiredMessage
		} else {
			*errMsg = "Could not load data. Please try again."
		}
		ctx.Update()
		return
	}
	set()
	*state = loadDone
	ctx.Update()
}

// renderLoad shows loading / error chrome, or the supplied content when loaded.
func renderLoad(state loadState, errMsg string, content func() app.UI) app.UI {
	switch state {
	case loadLoading, loadIdle:
		return app.P().Class("loading").Text("Loading…")
	case loadError:
		return renderLoadError(errMsg)
	default:
		return content()
	}
}

func renderLoadError(errMsg string) app.UI {
	return app.Div().Class("load-error").Body(
		app.P().Text(errMsg),
		app.If(errMsg == sessionExpiredMessage, func() app.UI {
			return app.A().Class("sign-in-link").Href("/login").Text("Sign in")
		}),
	)
}

func requirementList(heading, class string, items []string) app.UI {
	return app.If(len(items) > 0, func() app.UI {
		return app.Div().Class(class).Body(
			app.H2().Text(heading),
			app.Ul().Body(
				app.Range(items).Slice(func(i int) app.UI {
					return app.Li().Text(items[i])
				}),
			),
		)
	})
}

func renderRoute(route JobRoute) app.UI {
	return app.If(route.RouteType != "" || route.RecommendedRoute != "", func() app.UI {
		return app.Div().Class("job-route").Body(
			app.H2().Text("How to apply"),
			app.P().Class("job-route-type").Text(RouteLabel(route)),
			app.If(route.ApplicationURL != "", func() app.UI {
				return app.A().
					Class("job-route-link").
					Href(route.ApplicationURL).
					Target("_blank").
					Text("Open application")
			}),
		)
	})
}

// RouteLabel renders a resolved route for display, preferring the recommended
// route string and falling back to the route type.
func RouteLabel(route JobRoute) string {
	if route.RecommendedRoute != "" {
		return route.RecommendedRoute
	}
	if route.RouteType != "" {
		return route.RouteType
	}
	return "unknown"
}

// jobIDFromPath extracts the numeric job id from a "/jobs/:id" path. It returns
// ok=false when the path does not match that shape.
func jobIDFromPath(path string) (int, bool) {
	const prefix = "/jobs/"
	if len(path) <= len(prefix) || path[:len(prefix)] != prefix {
		return 0, false
	}
	id, err := strconv.Atoi(path[len(prefix):])
	if err != nil {
		return 0, false
	}
	return id, true
}
