module Api
  # Ingestion history for the PWA landing screen: recently-ingested JobPosts
  # grouped into batches (one alert/digest email = one batch), newest first.
  # Read-only; reuses IngestionBatchBuilder and never triggers scoring or the LLM.
  class IngestionBatchesController < BaseController
    def index
      batches = IngestionBatchBuilder.new.call
      total = batches.length

      page_size = JobPostsController.page_size
      page_number = requested_page
      offset = (page_number - 1) * page_size

      page = batches.slice(offset, page_size) || []

      render json: {
        batches: page,
        page: {
          number: page_number,
          size: page_size,
          total: total,
          has_next: offset + page.length < total
        }
      }
    end

    private

    def requested_page
      page = params[:page].to_i
      page.positive? ? page : 1
    end
  end
end
