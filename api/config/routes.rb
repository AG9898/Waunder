Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Application API. All client-facing endpoints live under /api.
  namespace :api do
    get "health", to: "health#show"
    resource :session, only: %i[create destroy]

    # Single-user structured profile and resume ingest. The portfolio export
    # pipeline pushes its JSON Resume + PDF to POST /api/profile/resume.
    resource :profile, only: %i[show update], controller: "profile"
    post "profile/resume", to: "resume_documents#create"
    get "push/vapid_public_key", to: "push_subscriptions#public_key"
    resource :push_subscription, only: %i[create destroy]
    get "digest", to: "digest#show"
    resources :job_posts, only: %i[index show create] do
      resources :contact_candidates, only: %i[index create]
    end
    resources :contact_candidates, only: [] do
      resources :outreach_drafts, only: %i[create]
    end
    resources :applications, only: [] do
      post :submit, on: :member
    end
    resources :worker_tasks, only: %i[index] do
      post :report, on: :member
    end
  end

  post "webhooks/resend/inbound", to: "webhooks/resend#inbound"

  # Defines the root path route ("/")
  # root "posts#index"
end
