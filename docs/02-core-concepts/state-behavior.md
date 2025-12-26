# 상태와 행위 (State and Behavior)

> Actor의 상태 관리와 동적 행위 변경

## 개요

Actor는 **상태(State)**와 **행위(Behavior)**를 캡슐화합니다. 외부에서 Actor의 상태에 직접 접근할 수 없으며, 오직 메시지를 통해서만 상호작용합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Actor                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    Private State                         │   │
│   │                                                          │   │
│   │   • 외부에서 직접 접근 불가                              │   │
│   │   • 메시지 처리 시에만 변경                              │   │
│   │   • 단일 스레드에서만 접근 (동시성 안전)                 │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     Behavior                             │   │
│   │                                                          │   │
│   │   • 메시지를 어떻게 처리할지 정의                        │   │
│   │   • 런타임에 동적으로 변경 가능 (become/unbecome)        │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 상태 (State)

### 상태의 특징

1. **캡슐화**: 외부에서 직접 접근 불가
2. **불변성 권장**: 가능하면 불변 데이터 구조 사용
3. **단일 소유**: 하나의 Actor만 해당 상태 소유
4. **스레드 안전**: 단일 스레드에서만 접근

### 상태 관리 예시

```typescript
// TypeScript
interface PlayerState {
  readonly id: string;
  readonly name: string;
  level: number;
  experience: number;
  inventory: ReadonlyArray<Item>;
}

class PlayerActor extends Actor<PlayerMessage> {
  private state: PlayerState;

  constructor(id: string, name: string) {
    super();
    this.state = {
      id,
      name,
      level: 1,
      experience: 0,
      inventory: []
    };
  }

  protected receive(message: PlayerMessage): void {
    switch (message.type) {
      case 'GAIN_EXP':
        this.state.experience += message.amount;
        this.checkLevelUp();
        break;

      case 'ADD_ITEM':
        // 불변성 유지하며 상태 업데이트
        this.state = {
          ...this.state,
          inventory: [...this.state.inventory, message.item]
        };
        break;

      case 'GET_STATE':
        // 상태 복사본 반환 (원본 보호)
        message.replyTo.send({
          type: 'STATE_RESPONSE',
          state: { ...this.state }
        });
        break;
    }
  }
}
```

```csharp
// C# Orleans
public class PlayerGrain : Grain, IPlayerGrain
{
    private PlayerState _state = new();

    public Task<int> GetLevel() => Task.FromResult(_state.Level);

    public async Task GainExperience(int amount)
    {
        _state.Experience += amount;

        while (_state.Experience >= ExperienceForLevel(_state.Level + 1))
        {
            _state.Level++;
            // 레벨업 이벤트 발행
        }
    }
}
```

## 행위 (Behavior)

### 정적 행위

대부분의 Actor는 고정된 행위를 가집니다:

```scala
// Akka - 정적 행위
class CalculatorActor extends Actor {
  def receive: Receive = {
    case Add(a, b) => sender() ! Result(a + b)
    case Sub(a, b) => sender() ! Result(a - b)
    case Mul(a, b) => sender() ! Result(a * b)
    case Div(a, b) => sender() ! Result(a / b)
  }
}
```

### 동적 행위 변경 (Become/Unbecome)

Actor는 런타임에 행위를 변경할 수 있습니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                  Become/Unbecome Pattern                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   초기 상태                                                      │
│   ┌──────────────────┐                                          │
│   │  normalBehavior  │                                          │
│   └────────┬─────────┘                                          │
│            │                                                     │
│            │ become(busyBehavior)                               │
│            ▼                                                     │
│   ┌──────────────────┐     Behavior Stack:                      │
│   │   busyBehavior   │     ┌─────────────────┐                  │
│   └────────┬─────────┘     │ busyBehavior    │ ← top            │
│            │               │ normalBehavior  │                  │
│            │ unbecome()    └─────────────────┘                  │
│            ▼                                                     │
│   ┌──────────────────┐                                          │
│   │  normalBehavior  │     (스택에서 pop)                       │
│   └──────────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Akka become/unbecome 예시

```scala
class SwitchableActor extends Actor {
  import context._

  // 초기 행위
  def receive = off

  def off: Receive = {
    case "switch" =>
      println("Turning ON")
      become(on)  // 행위 변경

    case msg =>
      println(s"OFF state, ignoring: $msg")
  }

  def on: Receive = {
    case "switch" =>
      println("Turning OFF")
      become(off)  // 행위 변경

    case msg =>
      println(s"ON state, processing: $msg")
  }
}
```

### 실용적인 예시: 연결 상태 관리

```scala
class ConnectionActor extends Actor {
  import context._

  def receive = disconnected

  def disconnected: Receive = {
    case Connect(host) =>
      println(s"Connecting to $host...")
      // 연결 로직
      become(connecting(host))

    case SendData(data) =>
      println("Cannot send: not connected")
      sender() ! Error("Not connected")
  }

  def connecting(host: String): Receive = {
    case ConnectionEstablished =>
      println(s"Connected to $host")
      become(connected(host))

    case ConnectionFailed(reason) =>
      println(s"Connection failed: $reason")
      become(disconnected)

    case SendData(data) =>
      stash()  // 연결 완료 후 처리하도록 보관
  }

  def connected(host: String): Receive = {
    case SendData(data) =>
      println(s"Sending to $host: $data")
      // 데이터 전송

    case Disconnect =>
      println(s"Disconnecting from $host")
      become(disconnected)

    case ConnectionLost =>
      println("Connection lost, reconnecting...")
      become(connecting(host))
  }
}
```

## FSM (Finite State Machine) 패턴

복잡한 상태 전이가 필요할 때 FSM 패턴을 사용합니다:

```scala
import akka.actor.FSM

// 상태 정의
sealed trait State
case object Idle extends State
case object Active extends State
case object Paused extends State

// 데이터 정의
sealed trait Data
case object Uninitialized extends Data
case class TaskData(task: Task, progress: Int) extends Data

class TaskProcessor extends FSM[State, Data] {

  startWith(Idle, Uninitialized)

  when(Idle) {
    case Event(StartTask(task), Uninitialized) =>
      goto(Active) using TaskData(task, 0)
  }

  when(Active) {
    case Event(Progress(amount), TaskData(task, progress)) =>
      val newProgress = progress + amount
      if (newProgress >= 100) {
        goto(Idle) using Uninitialized
      } else {
        stay using TaskData(task, newProgress)
      }

    case Event(Pause, data) =>
      goto(Paused) using data
  }

  when(Paused) {
    case Event(Resume, data) =>
      goto(Active) using data

    case Event(Cancel, _) =>
      goto(Idle) using Uninitialized
  }

  // 상태 전이 시 실행
  onTransition {
    case Idle -> Active =>
      log.info("Task started")
    case Active -> Idle =>
      log.info("Task completed")
    case _ -> Paused =>
      log.info("Task paused")
  }

  initialize()
}
```

## 상태 영속화

Actor 재시작 시 상태를 복원하기 위해 영속화가 필요합니다:

```scala
// Akka Persistence
class PersistentCounter extends PersistentActor {
  override def persistenceId = "counter-1"

  var count = 0

  // 명령 처리
  def receiveCommand: Receive = {
    case Increment =>
      persist(Incremented) { event =>
        count += 1
        sender() ! count
      }

    case GetCount =>
      sender() ! count
  }

  // 복구 시 이벤트 재생
  def receiveRecover: Receive = {
    case Incremented => count += 1
  }
}
```

```csharp
// Orleans - 자동 상태 영속화
public class CounterGrain : Grain, ICounterGrain
{
    private readonly IPersistentState<CounterState> _state;

    public CounterGrain(
        [PersistentState("counter", "counterStore")]
        IPersistentState<CounterState> state)
    {
        _state = state;
    }

    public async Task<int> Increment()
    {
        _state.State.Value++;
        await _state.WriteStateAsync();  // 영속화
        return _state.State.Value;
    }
}
```

## 모범 사례

### 1. 불변 상태 사용

```typescript
// 좋은 예: 불변 업데이트
this.state = {
  ...this.state,
  items: [...this.state.items, newItem]
};

// 나쁜 예: 가변 업데이트
this.state.items.push(newItem);  // 피해야 함
```

### 2. 상태 유효성 검증

```scala
def receive: Receive = {
  case Withdraw(amount) if amount > 0 && amount <= balance =>
    balance -= amount
    sender() ! Success(balance)

  case Withdraw(amount) if amount > balance =>
    sender() ! Failure("Insufficient funds")

  case Withdraw(amount) if amount <= 0 =>
    sender() ! Failure("Invalid amount")
}
```

### 3. 행위 변경 시 상태 보존

```scala
def active(data: SessionData): Receive = {
  case Pause =>
    become(paused(data))  // 데이터 유지

  case Update(newData) =>
    become(active(newData))  // 새 데이터로 행위 유지
}
```

## 관련 문서

- [Actor 개념](./actor.md)
- [Mailbox](./mailbox.md)
- [FSM 패턴](../11-patterns/README.md#5-fsm-finite-state-machine-패턴)
