# "Let it Crash" 철학

> Erlang에서 시작된 장애 처리 패러다임

## 개요

"Let it Crash"는 **방어적 프로그래밍 대신 장애를 허용**하고, 이를 **감독 시스템이 복구**하도록 하는 철학입니다.

```
┌─────────────────────────────────────────────────────────────────┐
│              Defensive Programming vs Let it Crash              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Defensive Programming:                                         │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  try {                                                   │   │
│   │      if (input == null) { handleNull(); }                │   │
│   │      if (!isValid(input)) { handleInvalid(); }           │   │
│   │      if (connection.isClosed()) { reconnect(); }         │   │
│   │      // 모든 경우를 예측하고 처리...                     │   │
│   │      doActualWork(input);                                │   │
│   │  } catch (Exception e) {                                 │   │
│   │      logError(e);                                        │   │
│   │      tryRecovery();                                      │   │
│   │      // 복잡한 복구 로직...                              │   │
│   │  }                                                       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   Let it Crash:                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  doActualWork(input);  // 그냥 실행                      │   │
│   │  // 문제 발생 시 → 크래시 → Supervisor가 재시작         │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 왜 "Let it Crash"인가?

### 1. 완벽한 에러 처리는 불가능

```
현실:
• 모든 예외 상황을 예측할 수 없음
• 복잡한 에러 처리 코드에도 버그 존재
• 에러 처리 코드가 비즈니스 로직보다 복잡해짐

Let it Crash 접근:
• 알려진 정상 경로만 처리
• 예상치 못한 상황 → 크래시 → 깨끗한 재시작
• 단순하고 예측 가능한 코드
```

### 2. 깨끗한 상태로 복구

```
┌─────────────────────────────────────────────────────────────────┐
│              Clean State Recovery                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   복구 시도 방식:                                                │
│   ┌─────────────────────┐                                       │
│   │  손상된 상태        │ ──복구 시도──▶ 더 손상된 상태 가능   │
│   │  (부분적 오류)      │                                       │
│   └─────────────────────┘                                       │
│                                                                  │
│   Let it Crash 방식:                                             │
│   ┌─────────────────────┐                                       │
│   │  손상된 상태        │ ──재시작──▶ 깨끗한 초기 상태         │
│   │  (어떤 오류든)      │                                       │
│   └─────────────────────┘                                       │
│                                                                  │
│   재시작은 항상 알려진 정상 상태에서 시작                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. 장애 격리

```
Actor 하나의 크래시 → 해당 Actor만 영향
                    ↓
              Supervisor가 재시작
                    ↓
              시스템 나머지는 정상 동작

vs 전통적 방식:
예외 발생 → 잘못된 에러 처리 → 연쇄 장애 → 시스템 전체 영향
```

## 실제 적용

### Erlang 예시

```erlang
%% 방어적 프로그래밍 (하지 말아야 할 것)
defensive_divide(X, Y) ->
    case Y of
        0 -> {error, division_by_zero};
        _ ->
            case is_number(X) and is_number(Y) of
                true -> {ok, X / Y};
                false -> {error, invalid_input}
            end
    end.

%% Let it Crash (권장)
let_it_crash_divide(X, Y) ->
    X / Y.  %% Y가 0이면 그냥 크래시
            %% Supervisor가 처리할 것
```

### Akka 예시

```scala
// 방어적 프로그래밍 (복잡)
class DefensiveActor extends Actor {
  def receive: Receive = {
    case ProcessData(data) =>
      try {
        if (data == null) {
          sender() ! Error("null data")
        } else if (!isValid(data)) {
          sender() ! Error("invalid data")
        } else {
          val result = process(data)
          if (result == null) {
            sender() ! Error("processing failed")
          } else {
            sender() ! Success(result)
          }
        }
      } catch {
        case e: IOException =>
          log.error("IO error", e)
          retryLater(data)
        case e: TimeoutException =>
          log.error("Timeout", e)
          sender() ! Error("timeout")
        case e: Exception =>
          log.error("Unknown error", e)
          // 여기서 뭘 해야 할지?
      }
  }
}

// Let it Crash (단순)
class LetItCrashActor extends Actor {
  def receive: Receive = {
    case ProcessData(data) =>
      val result = process(data)  // 실패하면 예외 발생
      sender() ! Success(result)   // 성공 시에만 도달
  }
}

// Supervisor가 장애 처리
class ParentActor extends Actor {
  override val supervisorStrategy = OneForOneStrategy() {
    case _: IOException      => Restart  // 재시작
    case _: TimeoutException => Restart
    case _: Exception        => Restart
  }

  val worker = context.actorOf(Props[LetItCrashActor])
}
```

## 언제 예외를 잡아야 하는가?

"Let it Crash"가 모든 예외를 무시하라는 의미는 아닙니다:

```
┌─────────────────────────────────────────────────────────────────┐
│              When to Catch vs When to Crash                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   예외를 잡아야 할 때:                                           │
│   ─────────────────────                                          │
│   • 예상된 비즈니스 오류 (잔액 부족 등)                         │
│   • 사용자에게 의미 있는 응답 필요                              │
│   • 정상 흐름의 일부인 경우                                     │
│                                                                  │
│   예시:                                                          │
│   case Withdraw(amount) if balance >= amount =>                 │
│     balance -= amount                                           │
│     sender() ! Success                                          │
│                                                                  │
│   case Withdraw(amount) if balance < amount =>                  │
│     sender() ! InsufficientFunds  // 비즈니스 로직              │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   크래시해야 할 때:                                              │
│   ────────────────                                               │
│   • 예상치 못한 오류                                            │
│   • 시스템 레벨 오류 (메모리 부족, 네트워크 등)                 │
│   • 복구 방법을 모르는 경우                                     │
│   • 상태가 손상되었을 수 있는 경우                              │
│                                                                  │
│   예시:                                                          │
│   case ProcessFile(path) =>                                     │
│     val content = Files.read(path)  // IOException → 크래시    │
│     process(content)                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 패턴: Error Kernel

중요한 상태는 별도 Actor로 분리:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Error Kernel Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│        [State Keeper] ← 최소한의 로직, 거의 크래시하지 않음     │
│              │                                                  │
│              │ 상태 요청/저장                                    │
│              ▼                                                  │
│     [Processor Actor] ← 복잡한 로직, 크래시 가능               │
│              │                                                  │
│              │ 위험한 작업                                       │
│              ▼                                                  │
│    [External Service] ← I/O, 네트워크 등                        │
│                                                                  │
│   Processor가 크래시해도 State Keeper의 상태는 보존             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

```scala
// State Keeper - 단순하고 안전
class StateKeeper extends Actor {
  var state: ImportantState = initialState

  def receive: Receive = {
    case GetState => sender() ! state
    case UpdateState(newState) => state = newState
  }
}

// Processor - 복잡하고 크래시 가능
class Processor(stateKeeper: ActorRef) extends Actor {
  def receive: Receive = {
    case DoComplexWork(data) =>
      val currentState = (stateKeeper ? GetState).mapTo[State]
      val result = dangerousProcessing(data, currentState)  // 크래시 가능
      stateKeeper ! UpdateState(result)
  }
}
```

## 장점

1. **단순한 코드**: 에러 처리 로직 최소화
2. **예측 가능성**: 재시작은 항상 깨끗한 상태
3. **장애 격리**: 한 부분의 문제가 전체에 영향 없음
4. **빠른 복구**: 복잡한 복구 로직 대신 즉시 재시작

## 주의사항

1. **상태 손실**: 재시작 시 메모리 상태 손실 (필요 시 영속화)
2. **무한 재시작 방지**: Supervisor 전략에 제한 설정
3. **외부 리소스**: 연결, 파일 핸들 등 정리 필요

## 관련 문서

- [감독 트리](./supervision-tree.md)
- [재시작 전략](./restart-strategies.md)
- [장애 허용 설계](./fault-tolerance.md)
