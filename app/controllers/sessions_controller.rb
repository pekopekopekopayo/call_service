class SessionsController < ApplicationController
  def new
  end

  def create
    user = User.find_by(email: params[:email])

    if user&.authenticate(params[:password])
      session[:user_id] = user.id
      redirect_to users_path, notice: "로그인 완료!"
    else
      flash.now[:alert] = "이메일/비밀번호가 올바르지 않아요."
      render :new, status: :unprocessable_entity
    end
  end

  def destroy
    reset_session
    redirect_to login_path, notice: "로그아웃 완료!"
  end
end
