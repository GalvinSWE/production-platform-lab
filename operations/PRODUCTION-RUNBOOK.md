# Production Platform Runbook

Tài liệu vận hành cho `production-platform-lab` trên Multipass VM
`production-lab`.

## Luồng release

```text
feature branch
  -> Pull Request vào develop
  -> test + build immutable ARM64 image
  -> deploy staging + smoke test
  -> Pull Request develop vào main
  -> test + build lại image theo commit main
  -> manual production approval
  -> rolling deployment
  -> HTTPS smoke test
  -> success hoặc automatic rollback
```

## Địa chỉ dịch vụ

- Staging HTTPS: `https://192.168.252.2:8443`
- Production HTTPS: `https://192.168.252.2:9443`
- Production HTTP: `http://192.168.252.2:8090` (redirect sang HTTPS)
- Grafana: `http://192.168.252.2:3001`
- Prometheus, Loki, Tempo và Alloy chỉ bind vào loopback của VM.

## Khởi động và dừng VM

Trên Mac:

```bash
multipass start production-lab
multipass shell production-lab
```

Docker containers dùng `restart: unless-stopped`, vì vậy chúng tự khởi động lại
sau khi Docker daemon sẵn sàng.

Để dừng lab:

```bash
multipass stop production-lab
```

## Smoke test production

Trong VM:

```bash
curl -k https://127.0.0.1:9443/ready
curl -k https://127.0.0.1:9443/whoami
curl -k https://127.0.0.1:9443/items
```

Kết quả mong đợi:

- `/ready`: `status=ready`, `database=connected`.
- `/whoami`: `environment=production` và version đúng commit đã release.
- `/items`: dữ liệu cũ vẫn tồn tại.

## Kiểm tra containers

```bash
cd ~/platform-deploy
docker compose \
  --env-file environments/production.env \
  -p platform-production \
  ps

docker ps --filter health=unhealthy
```

Production bình thường có hai API instances, gateway, PostgreSQL, Redis,
RabbitMQ, MinIO, hai workers và outbox relay. Lệnh thứ hai không được trả về
container nào.

## Monitoring và logs

```bash
curl http://127.0.0.1:9090/-/ready
curl http://127.0.0.1:3100/ready
curl http://127.0.0.1:3200/ready
curl http://127.0.0.1:3001/api/health
```

Loki có thể trả `503` khoảng 15 giây ngay sau khi VM khởi động trong lúc
ingester hoàn tất readiness delay.

Prometheus query kiểm tra hai production targets:

```promql
up{job="production-api"}
```

Giá trị mong đợi cho cả hai instances là `1`.

Grafana alert rule không được coi việc không có lỗi HTTP 5xx là sự cố. Rule
`High HTTP 5xx error rate` phải đặt `No data state = OK`.

## Rollback

Pipeline lưu `APP_IMAGE` và `APP_VERSION` trước khi rollout. Khi container mới
không healthy hoặc HTTPS smoke test thất bại, pipeline:

1. Khôi phục image và version trước trong environment file.
2. Recreate API, workers và outbox relay.
3. Restart gateway.
4. Kết thúc job với trạng thái failed để người vận hành biết release không
   thành công.

Sau rollback, luôn chạy lại ba endpoint trong mục smoke test và kiểm tra dữ liệu.

## Backup và recovery

```bash
systemctl status platform-backup.timer
journalctl -u platform-backup.service --since today
```

Script backup nằm tại `operations/backup-postgres.sh`. Một bản backup chỉ được
coi là hợp lệ sau khi đã restore thử và truy vấn được dữ liệu.

## Secret và certificate

- Không commit file environment thật, password, private key hoặc token.
- Runtime secrets nằm trong `~/platform-deploy/secrets/<environment>/`.
- TLS certificate production nằm trong `~/platform-deploy/tls/production/`.
- Sau khi rotate secret hoặc certificate, validate Compose rồi recreate service
  sử dụng secret đó.

## Checklist đóng sự cố

- API `/ready` trả 200.
- Version trên `/whoami` đúng release mong muốn.
- Cả hai API instances xuất hiện qua gateway.
- Dữ liệu PostgreSQL còn nguyên.
- Prometheus targets đều up.
- Loki nhận log mới và Tempo ready.
- Grafana không còn active alert ngoài alert đang được điều tra.
- Ghi lại nguyên nhân, cách sửa và biện pháp ngăn tái diễn.

## Trạng thái xác nhận của lab

- Pipeline main `#20260819.10`: production deployment thành công.
- Production version: `9d36138b7dcdcec9d829cc73fa30326a3a094110`.
- Controlled unhealthy-image test: rollback thành công.
- Dữ liệu tồn tại sau rollback và VM restart.
- Hai production targets có Prometheus `up=1`.
- Prometheus, Loki, Tempo và Grafana đều ready.
