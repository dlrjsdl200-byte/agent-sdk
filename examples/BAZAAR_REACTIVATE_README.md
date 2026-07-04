# Bazaar 재활성화 실행 안내

MGO를 CDP x402 Bazaar 검색에 다시 노출시키기 위한 1회 셀프 결제 절차입니다.

## 배경

- Bazaar는 **30일간 결제 정산이 없는 리소스를 검색 결과에서 제외**합니다.
- MGO의 마지막 실결제는 2026-03-08 → 4월 초부터 Bazaar 검색에서 **제외 상태**.
- 정산된 결제 1건이면 ~6시간 뒤 검색에 복귀합니다 (Bazaar는 6시간마다 recency/quality 재계산).

## 사전 준비

1. **결제용 지갑** (PRIVATE_KEY 보유). ⚠️ 수신 지갑 `0x665bab4…dd7a`와 **다른 지갑**을 쓰세요 — 그래야 나중에 입금 내역에서 셀프 결제와 실제 매출을 구분할 수 있습니다.
2. 그 지갑에 **Base 메인넷 USDC ≥ $0.001** (넉넉히 $0.01 정도). 결제는 EIP-3009 오프체인 서명이라 agent 쪽 가스는 facilitator가 대납하지만, USDC 잔액은 필요합니다.

## 실행

```bash
cd F:\x402\agent-sdk

# 1) DRY RUN — 견적만 확인, 한 푼도 안 씀 (이미 통과 확인됨)
npx tsx examples/bazaar-reactivate.ts

# 2) 실제 결제 — Bazaar 재활성화 (USDC가 실제로 이동합니다)
#    PowerShell:
$env:PRIVATE_KEY="0x여기에_결제지갑_키"; $env:DRY_RUN="0"; npx tsx examples/bazaar-reactivate.ts
```

> PRIVATE_KEY는 환경변수로만 읽고 파일·로그에 절대 남기지 않습니다. 커밋하지 않는 로컬 `.env`에서 불러오는 걸 권장합니다.

## 실행 후 검증

1. 스크립트가 출력한 `tx hash`를 `https://basescan.org/tx/<hash>`에서 확인 (Success).
2. **~6시간 뒤** Bazaar 검색에 MGO가 다시 노출되는지 확인.
3. 수신 지갑 입금 내역에 $0.001 도착 확인.

## 지속 유지 (선택 — 이번 범위 밖)

이번엔 1회만 실행합니다. 지속 노출을 원하면 나중에 **주 1회 자동 셀프 결제**(GitHub Actions 크론)를 붙일 수 있습니다. 월 비용 ~$0.004. 그때 다시 요청하세요.
