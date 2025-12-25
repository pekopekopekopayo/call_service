import { Controller } from "@hotwired/stimulus"
import { getConsumer } from "channels/consumer"

export default class extends Controller {
  static values = {
    currentUserId: Number
  }

  connect() {
    if (!this.hasCurrentUserIdValue) return
    this.subscribe()
  }

  disconnect() {
    if (!this.subscription) return
    this.subscription.unsubscribe()
    this.subscription = null
  }

  subscribe() {
    if (this.subscription) return

    this.subscription = getConsumer().subscriptions.create("CallChannel", {
      received: (data) => this.received(data)
    })
  }

  received(data) {
    const fromUserId = data?.from_user_id
    const payload = data?.payload
    if (!fromUserId || !payload) return

    window.dispatchEvent(new CustomEvent("call:signal", { detail: data }))

    if (document.querySelector('[data-controller~="call-room"]')) return
    if (payload.type !== "offer") return

    try {
      sessionStorage.setItem(
        this.incomingOfferKey(fromUserId),
        JSON.stringify({ fromUserId, payload, receivedAt: Date.now() })
      )
    } catch {
      // noop
    }

    const ok = window.confirm("전화가 왔어요. 받으시겠어요?")
    if (!ok) return

    window.location.href = `/calls/${fromUserId}?incoming=1`
  }

  incomingOfferKey(fromUserId) {
    return `call:incoming_offer:${fromUserId}`
  }
}
