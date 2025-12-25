class CallChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_user
  end

  def signal(data)
    to_user_id = data["to_user_id"]
    payload = data["payload"]

    return if to_user_id.blank? || payload.blank?

    to_user = User.find_by(id: to_user_id)
    return if to_user.blank?

    CallChannel.broadcast_to(
      to_user,
      {
        from_user_id: current_user.id,
        payload: payload
      }
    )
  end
end
