module Api
  # Ingestion history for the PWA landing screen: recently-ingested JobPosts
  # grouped into batches (one alert/digest email = one batch), newest first.
  # Read-only; reuses IngestionBatchBuilder and never triggers scoring or the LLM.
  class IngestionBatchesController < BaseController
    def index
      batches = IngestionBatchBuilder.new.call

      render json: { batches: batches }
    end
  end
end
