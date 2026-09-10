import { useRegisterSW } from "virtual:pwa-register/react";

/** Displays only after Workbox has downloaded a new build and is waiting to activate it. */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  function reload() {
    // Workbox activates the waiting worker and reloads only after the owner explicitly chooses it.
    void updateServiceWorker();
  }

  return (
    <div className="app-update" role="status">
      <span className="app-update-text">A new version of Waunder is ready.</span>
      <button className="app-update-reload" type="button" onClick={reload}>
        Reload
      </button>
    </div>
  );
}
