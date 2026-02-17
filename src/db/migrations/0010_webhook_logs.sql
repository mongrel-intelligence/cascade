-- Webhook call logging: stores last N incoming webhook calls for debugging
CREATE TABLE webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    headers JSONB,
    body JSONB,
    body_raw TEXT,
    status_code INT,
    received_at TIMESTAMP DEFAULT now(),
    project_id TEXT,
    event_type TEXT,
    processed BOOLEAN DEFAULT false
);

-- Index for time-based queries (most common: list recent logs)
CREATE INDEX idx_webhook_logs_received_at ON webhook_logs (received_at DESC);

-- Index for filtering by source
CREATE INDEX idx_webhook_logs_source ON webhook_logs (source);

-- Composite index for source + time (filtered list queries)
CREATE INDEX idx_webhook_logs_source_received_at ON webhook_logs (source, received_at DESC);
