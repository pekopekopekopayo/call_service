class UsersController < ApplicationController
  before_action :require_login, only: %i[index show]

  def index
    @users = User.order(created_at: :desc)
  end

  def show
    @user = User.find(params[:id])
  end

  def new
    @user = User.new
  end

  def create
    @user = User.new(create_params)

    if @user.save
      session[:user_id] = @user.id
      redirect_to users_path, notice: "가입 완료!"
    else
      flash.now[:alert] = "가입 실패"
      render :new, status: :unprocessable_entity
    end
  end

  private

  def create_params
    params.require(:user).permit(:email, :name, :password, :password_confirmation)
  end
end
