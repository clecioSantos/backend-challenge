#!/bin/bash
# ---------------------------------------------------------------------------
# LocalStack ready hook: provision the FIFO queues used by the processor.
#
#   wager-transactions.fifo       -> main ingestion queue
#   wager-transactions-dlq.fifo   -> dead letter queue (redrive target)
#
# The main queue owns a redrive policy pointing at the DLQ so that, even
# though the application performs its own attempt accounting, the broker also
# moves poison messages after `maxReceiveCount` deliveries.
# ---------------------------------------------------------------------------
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ACCOUNT_ID="000000000000"
MAIN_QUEUE="wager-transactions.fifo"
DLQ="wager-transactions-dlq.fifo"
EVENTS_QUEUE="wager-events.fifo"
DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${DLQ}"

echo "[localstack-init] provisioning SQS queues in region ${REGION}"

awslocal sqs create-queue \
  --queue-name "${DLQ}" \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}' \
  >/dev/null

# Fila dedicada aos eventos de integração publicados pelo outbox. Fica separada
# da fila de requisições para que o consumidor nunca trate um evento como uma
# nova operação de aposta.
awslocal sqs create-queue \
  --queue-name "${EVENTS_QUEUE}" \
  --attributes '{"FifoQueue":"true","ContentBasedDeduplication":"false"}' \
  >/dev/null

awslocal sqs create-queue \
  --queue-name "${MAIN_QUEUE}" \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"VisibilityTimeout\":\"${SQS_VISIBILITY_TIMEOUT_SECONDS:-30}\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"${SQS_MAX_RECEIVE_COUNT:-5}\\\"}\"}" \
  >/dev/null

echo "[localstack-init] queues ready:"
awslocal sqs list-queues
