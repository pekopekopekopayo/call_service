import { Controller } from "@hotwired/stimulus"
import { getConsumer } from "channels/consumer"

export default class extends Controller {
  static targets = ["status", "localAudio", "remoteAudio"]

  static values = {
    currentUserId: Number,
    peerUserId: Number,
    turnUrl: String,
    turnUsername: String,
    turnCredential: String
  }

  connect() {
    this.started = false
    this.pendingIce = []
    this.updateStatus("대기 중...")

    this.subscribe()
    this.onSignal = (event) => this.handleSignalEvent(event)
    window.addEventListener("call:signal", this.onSignal)

    this.maybeAutoStartForIncoming()
  }

  async requestPermission() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.updateStatus("이 브라우저에서는 마이크를 사용할 수 없어요.")
      return
    }

    this.updateStatus("마이크 권한 요청 중...")

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach((t) => t.stop())
      this.updateStatus("마이크 권한이 허용됐어요. 이제 '전화 걸기/받기'를 누르세요.")
    } catch (e) {
      const name = e?.name

      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        this.updateStatus("마이크 권한이 차단됐어요. 브라우저 사이트 설정에서 마이크를 허용으로 바꿔 주세요.")
        return
      }

      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        this.updateStatus("마이크를 찾을 수 없어요. 마이크(헤드셋)를 연결하고 다시 시도해 주세요.")
        return
      }

      this.updateStatus(`마이크 권한 요청 실패: ${e?.message || e}`)
    }
  }

  disconnect() {
    window.removeEventListener("call:signal", this.onSignal)
    this.cleanup()

    if (!this.subscription) return
    this.subscription.unsubscribe()
    this.subscription = null
  }

  start() {
    if (this.started) return
    this.started = true

    this.bootstrap()
      .then(() => this.startOfferOrAnswer())
      .catch((e) => {
        this.updateStatus(`실패: ${e?.message || e}`)
        this.cleanup()
      })
  }

  hangup() {
    if (this.subscription) {
      this.subscription.perform("signal", {
        to_user_id: this.peerUserIdValue,
        payload: { type: "hangup" }
      })
    }

    this.cleanup()
    this.updateStatus("통화 종료")
  }

  subscribe() {
    if (this.subscription) return

    this.subscription = getConsumer().subscriptions.create("CallChannel", {
      received: (data) => this.received(data)
    })
  }

  received(data) {
    const fromUserId = data?.from_user_id
    if (Number(fromUserId) !== this.peerUserIdValue) return

    const payload = data?.payload
    if (!payload) return

    if (payload.type === "offer" && !this.started) {
      try {
        sessionStorage.setItem(this.incomingOfferKey(), JSON.stringify({ payload }))
      } catch {
        // noop
      }

      this.updateStatus("전화가 왔어요. '전화 걸기/받기'를 눌러 받으세요.")
      return
    }

    this.handlePayload(payload)
  }

  handleSignalEvent(event) {
    const data = event?.detail
    const fromUserId = data?.from_user_id
    if (Number(fromUserId) !== this.peerUserIdValue) return

    const payload = data?.payload
    if (!payload) return

    this.handlePayload(payload)
  }

  async bootstrap() {
    this.updateStatus("마이크 권한 요청 중...")
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (e) {
      const name = e?.name

      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        throw new Error("마이크를 찾을 수 없어요. 마이크(헤드셋)를 연결하고 OS/브라우저 마이크 권한을 확인해 주세요.")
      }

      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        throw new Error("마이크 권한이 거부됐어요. 브라우저/OS 설정에서 마이크 권한을 허용해 주세요.")
      }

      if (name === "NotReadableError" || name === "TrackStartError") {
        throw new Error("마이크를 사용할 수 없어요(다른 앱이 점유 중일 수 있어요). 마이크를 사용하는 앱을 종료하고 다시 시도해 주세요.")
      }

      throw new Error(`마이크 초기화 실패: ${e?.message || e}`)
    }

    this.localAudioTarget.srcObject = this.localStream

    this.updateStatus("연결 준비 중...")
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers()
    })

    this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream))

    this.pc.ontrack = (event) => {
      const [stream] = event.streams
      if (!stream) return
      this.remoteAudioTarget.srcObject = stream
    }

    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.send({ type: "ice", candidate: event.candidate })
    }

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState
      if (state) this.updateStatus(`연결 상태: ${state}`)
    }
  }

  async startOfferOrAnswer() {
    const incoming = this.readIncomingOffer()

    if (incoming) {
      this.updateStatus("받는 중...")
      await this.pc.setRemoteDescription(incoming)
      await this.flushPendingIce()

      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.send({ type: "answer", sdp: this.pc.localDescription })

      this.clearIncomingOffer()
      return
    }

    this.updateStatus("거는 중...")
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.send({ type: "offer", sdp: this.pc.localDescription })
  }

  async handlePayload(payload) {
    if (!this.pc && payload.type !== "hangup") return

    switch (payload.type) {
      case "answer":
        await this.pc.setRemoteDescription(payload.sdp)
        await this.flushPendingIce()
        this.updateStatus("통화 연결됨")
        break
      case "offer":
        await this.pc.setRemoteDescription(payload.sdp)
        await this.flushPendingIce()
        {
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          this.send({ type: "answer", sdp: this.pc.localDescription })
          this.updateStatus("통화 연결됨")
        }
        break
      case "ice":
        await this.addIce(payload.candidate)
        break
      case "hangup":
        this.cleanup()
        this.updateStatus("상대가 전화를 끊었어요.")
        break
      default:
        break
    }
  }

  send(payload) {
    if (!this.subscription) return

    this.subscription.perform("signal", {
      to_user_id: this.peerUserIdValue,
      payload
    })
  }

  async addIce(candidate) {
    if (!candidate) return
    if (this.pc.remoteDescription) {
      await this.pc.addIceCandidate(candidate)
      return
    }

    this.pendingIce.push(candidate)
  }

  async flushPendingIce() {
    if (!this.pc.remoteDescription) return
    if (this.pendingIce.length === 0) return

    const candidates = [...this.pendingIce]
    this.pendingIce = []
    for (const c of candidates) {
      await this.pc.addIceCandidate(c)
    }
  }

  cleanup() {
    if (this.pc) {
      this.pc.ontrack = null
      this.pc.onicecandidate = null
      this.pc.onconnectionstatechange = null
      this.pc.close()
      this.pc = null
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }
  }

  updateStatus(text) {
    if (!this.hasStatusTarget) return
    this.statusTarget.textContent = text
  }

  maybeAutoStartForIncoming() {
    if (!this.readIncomingOffer()) return
    this.updateStatus("수신 통화 준비됨. '전화 걸기/받기'를 눌러 받으세요.")
  }

  iceServers() {
    const servers = [{ urls: "stun:stun.l.google.com:19302" }]

    if (this.turnUrlValue && this.turnUsernameValue && this.turnCredentialValue) {
      servers.push({
        urls: this.turnUrlValue,
        username: this.turnUsernameValue,
        credential: this.turnCredentialValue
      })
    }

    return servers
  }

  incomingOfferKey() {
    return `call:incoming_offer:${this.peerUserIdValue}`
  }

  readIncomingOffer() {
    try {
      const raw = sessionStorage.getItem(this.incomingOfferKey())
      if (!raw) return null

      const parsed = JSON.parse(raw)
      const offer = parsed?.payload?.sdp
      if (!offer) return null

      return offer
    } catch {
      return null
    }
  }

  clearIncomingOffer() {
    try {
      sessionStorage.removeItem(this.incomingOfferKey())
    } catch {
      // noop
    }
  }
}
