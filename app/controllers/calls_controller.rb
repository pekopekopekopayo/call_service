class CallsController < ApplicationController
  before_action :require_login

  def show
    @peer = User.find(params[:id])

    if @peer.id == current_user.id
      redirect_to users_path, alert: "본인에게는 전화할 수 없어요."
    end
  end
end
