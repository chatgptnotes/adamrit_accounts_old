# Audit log shipping → WORM store (HIPAA #320 item 1)

Ships the sidecar/Main App **audit** logs (the structured JSON lines emitted by
`sidecar/audit.js` and `docker/serve.js`) to an immutable, append-only store
with **6-year retention** per 45 CFR §164.316(b)(2).

The application does not ship logs itself — it writes one JSON object per line to
**stdout** (the correct container pattern). This Fluent Bit DaemonSet tails those
container logs, keeps only audit records, and writes them to an **S3 bucket with
Object Lock (WORM)**. Retention is enforced by the *bucket*, so logs cannot be
altered or deleted — even by an admin — until the retention period elapses.

```
sidecar / serve.js ──stdout──▶ node container log ──▶ Fluent Bit (DaemonSet)
   keep records with an "action" field ──▶ S3 (Object Lock, 6-yr default retention)
```

## 1. Create the WORM bucket (one-time)

Object Lock can only be enabled at creation. `COMPLIANCE` mode means *no one* can
shorten retention or delete objects before expiry (vs `GOVERNANCE`, which a
privileged user can override).

```bash
aws s3api create-bucket \
  --bucket adamrit-audit-logs-worm \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1 \
  --object-lock-enabled-for-bucket

# 6 years = 2192 days. COMPLIANCE mode = immutable until expiry.
aws s3api put-object-lock-configuration \
  --bucket adamrit-audit-logs-worm \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": { "DefaultRetention": { "Mode": "COMPLIANCE", "Days": 2192 } }
  }'

# Also: block public access, enable default SSE-KMS encryption, enable versioning
# (required by Object Lock). Versioning is auto-enabled with Object Lock.
aws s3api put-bucket-encryption \
  --bucket adamrit-audit-logs-worm \
  --server-side-encryption-configuration '{
    "Rules": [{ "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "aws:kms" } }]
  }'
```

## 2. Grant write-only access via IRSA (no static keys)

Create an IAM role the Fluent Bit ServiceAccount can assume, scoped to
`s3:PutObject` on this bucket only (writers must not be able to delete/read):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject"],
    "Resource": "arn:aws:s3:::adamrit-audit-logs-worm/audit/*"
  }]
}
```

Put the role ARN in `fluent-bit-daemonset.yaml` →
`ServiceAccount.metadata.annotations.eks.amazonaws.com/role-arn`.

> Not on EKS? Use your platform's workload-identity equivalent (GKE Workload
> Identity, AKS workload identity), or a mounted secret with static keys as a
> last resort. The S3 output plugin works the same with GCS/MinIO-compatible
> stores — adjust `region`/endpoint in the ConfigMap.

## 3. Configure and apply

Edit `fluent-bit-audit-env` (region + bucket) in `fluent-bit-daemonset.yaml`, then:

```bash
kubectl apply -f k8s/logging/fluent-bit-configmap.yaml
kubectl apply -f k8s/logging/fluent-bit-daemonset.yaml
```

## 4. Verify

```bash
kubectl -n logging rollout status ds/fluent-bit-audit
kubectl -n logging logs ds/fluent-bit-audit | grep -i "s3"   # uploads
aws s3 ls s3://adamrit-audit-logs-worm/audit/ --recursive | tail

# Prove immutability: this MUST fail under COMPLIANCE mode.
aws s3api delete-object --bucket adamrit-audit-logs-worm \
  --key audit/<some-object>.jsonl    # => AccessDenied (WORM working)
```

## What is shipped (and what is not)

- **Shipped:** every audit record (any log line with an `action` field) from the
  Adamrit sidecar and Main App runtime.
- **Not shipped:** other container stdout (kept in the normal cluster log stream,
  not the 6-year WORM store) — keeps the immutable store focused and cheap.
- **PHI safety:** records are already PHI-free by construction (`sidecar/audit.js`
  allowlist). The `record_modifier` filter in the ConfigMap drops known PHI keys
  as a second layer before anything leaves the node.
