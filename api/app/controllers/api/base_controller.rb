module Api
  # Base controller for all /api endpoints. Shared concerns (auth, error
  # handling, serialization) for the single-user API will live here.
  class BaseController < ApplicationController
  end
end
