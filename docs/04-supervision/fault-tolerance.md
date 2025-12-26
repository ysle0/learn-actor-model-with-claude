# 장애 허용 시스템 설계 (Fault Tolerance)

> Actor Model로 견고한 시스템 구축하기

## 개요

장애 허용(Fault Tolerance)은 시스템의 일부가 실패해도 전체 시스템이 계속 동작하도록 설계하는 것입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│              Fault Tolerance Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    System                                │   │
│   │                                                          │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐               │   │
│   │   │Module A │  │Module B │  │Module C │               │   │
│   │   │   ✓     │  │   ✗     │  │   ✓     │               │   │
│   │   └─────────┘  └─────────┘  └─────────┘               │   │
│   │                    ↓                                     │   │
│   │               [격리 & 복구]                              │   │
│   │                    ↓                                     │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐               │   │
│   │   │Module A │  │Module B'│  │Module C │  ← 전체 동작   │   │
│   │   │   ✓     │  │   ✓     │  │   ✓     │               │   │
│   │   └─────────┘  └─────────┘  └─────────┘               │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 핵심 원칙

### 1. 장애 격리 (Failure Isolation)

```
┌─────────────────────────────────────────────────────────────────┐
│                   Failure Isolation                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   나쁜 설계 (격리 없음):                                         │
│   ┌─────────────────────────────────────┐                       │
│   │  ┌───┐ ──▶ ┌───┐ ──▶ ┌───┐ ──▶ ✗  │                       │
│   │  │ A │     │ B │     │ C │  장애   │                       │
│   │  └───┘     └───┘     └───┘         │                       │
│   │                                     │  ← 전체 영향          │
│   └─────────────────────────────────────┘                       │
│                                                                  │
│   좋은 설계 (격리):                                              │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                        │
│   │    A    │  │    B    │  │    C    │                        │
│   │   ✓     │  │   ✓     │  │   ✗     │                        │
│   └─────────┘  └─────────┘  └─────────┘                        │
│       ↑            ↑            ↓                               │
│    정상 동작    정상 동작    복구 중                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 계층적 복구 (Hierarchical Recovery)

```
Level 1: Actor 자체 처리 (try-catch, 상태 복구)
    ↓ 실패
Level 2: 직접 Supervisor가 재시작
    ↓ 반복 실패
Level 3: 상위 Supervisor로 에스컬레이션
    ↓ 계속 실패
Level 4: 하위 시스템 전체 재시작
    ↓ 여전히 실패
Level 5: 시스템 관리자 알림 / 서비스 중단
```

### 3. 실패 빠르게 (Fail Fast)

```
문제 감지 즉시 실패 선언:
• 손상된 상태로 계속 실행하지 않음
• 빠른 실패 = 빠른 복구
• 명확한 장애 경계

예시:
def process(data: Data): Unit = {
  require(data != null, "data is required")
  require(data.isValid, "data must be valid")
  // 검증 실패 시 즉시 예외 → Supervisor가 처리
}
```

## 설계 패턴

### Error Kernel 패턴

중요한 상태는 별도로 보호:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Error Kernel Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                 Core (Error Kernel)                      │   │
│   │                                                          │   │
│   │   ┌───────────────────────────────────────────────┐     │   │
│   │   │  State Keeper Actor                           │     │   │
│   │   │  • 최소한의 로직                              │     │   │
│   │   │  • 거의 실패하지 않음                         │     │   │
│   │   │  • 중요한 상태 보관                           │     │   │
│   │   └───────────────────────────────────────────────┘     │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           ↕                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                 Periphery (Workers)                      │   │
│   │                                                          │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐               │   │
│   │   │Processor│  │ Parser  │  │ IO      │               │   │
│   │   │         │  │         │  │ Handler │               │   │
│   │   └─────────┘  └─────────┘  └─────────┘               │   │
│   │   복잡한 로직, 실패 가능, 재시작 가능                   │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Circuit Breaker 패턴

외부 서비스 장애로부터 보호:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Circuit Breaker                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   상태 전이:                                                     │
│                                                                  │
│   ┌────────┐  5회 실패  ┌────────┐  타임아웃  ┌───────────┐    │
│   │ CLOSED │──────────▶│  OPEN  │───────────▶│ HALF-OPEN │    │
│   │(정상)  │           │(차단)  │            │ (테스트)  │    │
│   └────────┘           └────────┘            └───────────┘    │
│       ↑                                           │             │
│       │                    성공                   │             │
│       └───────────────────────────────────────────┘             │
│                                                                  │
│   효과:                                                          │
│   • 실패하는 외부 서비스 호출 방지                              │
│   • 빠른 실패 응답                                              │
│   • 외부 서비스 복구 시간 제공                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Bulkhead 패턴

리소스 분리로 장애 확산 방지:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Bulkhead Pattern                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     Thread Pools                         │   │
│   │                                                          │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│   │   │ API Pool     │  │ DB Pool      │  │ External Pool│ │   │
│   │   │ (10 threads) │  │ (20 threads) │  │ (5 threads)  │ │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘ │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   External Pool 고갈 시에도 API와 DB는 정상 동작                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 실제 구현 예시

### Akka 기반 장애 허용 시스템

```scala
class ResilientSystem extends Actor {
  // 서비스별 격리된 Dispatcher
  val apiDispatcher = context.system.dispatchers.lookup("api-dispatcher")
  val dbDispatcher = context.system.dispatchers.lookup("db-dispatcher")

  // 계층적 Supervision
  override val supervisorStrategy = OneForOneStrategy(
    maxNrOfRetries = 10,
    withinTimeRange = 1.minute
  ) {
    case _: DatabaseUnavailableException =>
      // DB 문제: 재시작 with backoff
      Restart

    case _: InvalidDataException =>
      // 데이터 문제: 해당 메시지만 스킵
      Resume

    case _: ConfigurationException =>
      // 설정 문제: 복구 불가
      Stop

    case _ =>
      // 알 수 없는 문제: 상위로
      Escalate
  }

  // 자식 Actor들
  val dbActor = context.actorOf(
    Props[DatabaseActor].withDispatcher("db-dispatcher"),
    "database"
  )

  val apiActor = context.actorOf(
    Props(new ApiActor(dbActor)).withDispatcher("api-dispatcher"),
    "api"
  )

  def receive: Receive = {
    case msg => apiActor forward msg
  }
}
```

### 상태 영속화

```scala
class PersistentAccountActor extends PersistentActor {
  override def persistenceId = s"account-${self.path.name}"

  var state = AccountState()

  // 복구: 이벤트 재생
  def receiveRecover: Receive = {
    case event: AccountEvent =>
      state = state.updated(event)

    case SnapshotOffer(_, snapshot: AccountState) =>
      state = snapshot
  }

  // 명령 처리
  def receiveCommand: Receive = {
    case Deposit(amount) =>
      persist(Deposited(amount)) { event =>
        state = state.updated(event)
        saveSnapshotIfNeeded()
      }
  }

  def saveSnapshotIfNeeded(): Unit = {
    if (lastSequenceNr % 100 == 0) {
      saveSnapshot(state)
    }
  }
}
```

## 모니터링과 알림

```
┌─────────────────────────────────────────────────────────────────┐
│                   Monitoring Setup                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   수집 메트릭:                                                   │
│   • Actor 재시작 횟수                                           │
│   • Mailbox 크기                                                │
│   • 메시지 처리 시간                                            │
│   • Dead Letter 수                                              │
│                                                                  │
│   알림 조건:                                                     │
│   • 재시작 횟수 > 임계치                                        │
│   • Mailbox 크기 > 임계치                                       │
│   • Dead Letter 급증                                            │
│   • Supervisor Escalation 발생                                  │
│                                                                  │
│   시각화:                                                        │
│   • Grafana 대시보드                                            │
│   • Actor 계층 트리 뷰                                          │
│   • 실시간 메시지 흐름                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 체크리스트

### 시스템 설계 시

- [ ] Supervision 계층 구조 정의
- [ ] 각 장애 유형별 복구 전략 수립
- [ ] 재시작 제한 설정 (maxRetries, timeRange)
- [ ] 중요 상태 영속화 방안
- [ ] Circuit Breaker 적용 (외부 서비스)
- [ ] 리소스 격리 (Bulkhead)

### 운영 시

- [ ] 재시작 이벤트 모니터링
- [ ] Dead Letter 모니터링
- [ ] 성능 메트릭 수집
- [ ] 알림 설정
- [ ] 정기적 장애 테스트 (Chaos Engineering)

## 관련 문서

- [감독 트리](./supervision-tree.md)
- [Let it Crash 철학](./let-it-crash.md)
- [재시작 전략](./restart-strategies.md)
- [Circuit Breaker 패턴](../11-patterns/circuit-breaker.md)
