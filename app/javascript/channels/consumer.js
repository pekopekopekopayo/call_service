import { createConsumer } from "@rails/actioncable"

let consumer

export function getConsumer() {
  if (consumer) return consumer

  consumer = createConsumer()
  return consumer
}
