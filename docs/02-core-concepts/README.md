# 02. Core Concepts - 핵심 개념

> Actor Model의 핵심 구성 요소를 이해합니다: Actor, Message, Mailbox

## 한 줄 요약

**Actor = State(상태) + Behavior(행위) + Mailbox(메시지 큐)**

---

## Actor의 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                         Actor 구조                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Actor                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │   State     │  │  Behavior   │  │    Mailbox      │  │   │
│  │  │             │  │             │  │                 │  │   │
│  │  │  - count    │  │  receive()  │  │  [msg1]         │  │   │
│  │  │  - name     │  │  {          │  │  [msg2]  ←──────│───── 메시지 수신
│  │  │  - status   │  │    ...      │  │  [msg3]         │  │   │
│  │  │             │  │  }          │  │                 │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  │        ↑                 │                               │   │
│  │        └─────── 상태 수정 ┘                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  핵심 규칙:                                                     │
│  • State는 오직 해당 Actor만 접근 가능                           │
│  • Mailbox에서 메시지를 하나씩 꺼내 순차 처리                     │
│  • 외부와는 오직 메시지를 통해서만 통신                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 핵심 요소

### 1. State (상태)

Actor의 내부 상태는 **완전히 캡슐화**됩니다.

```typescript
// TypeScript 예시
class PlayerActor {
  // 오직 이 Actor만 접근 가능한 상태
  private health: number = 100;
  private position: { x: number; y: number } = { x: 0, y: 0 };
  private inventory: Item[] = [];

  // 외부에서 직접 접근 불가능!
  // player.health = 0;  ❌ 컴파일 에러 아니어도 Actor 원칙 위반
}
```

**상태 접근 규칙:**
- ✅ 메시지 핸들러 내에서 상태 읽기/쓰기
- ❌ 외부에서 직접 상태 접근
- ❌ 다른 Actor의 상태 참조

### 2. Behavior (행위)

메시지를 받았을 때 수행할 로직을 정의합니다.

```cpp
// C++ CAF 예시
behavior player_actor(stateful_actor<player_state>* self) {
  return {
    // 메시지 타입별 핸들러 정의
    [=](move_atom, int x, int y) {
      self->state.x = x;
      self->state.y = y;
    },
    [=](attack_atom, actor_addr target) {
      self->send(target, damage_atom_v, 10);
    },
    [=](get_health_atom) {
      return self->state.health;
    }
  };
}
```

**Become: 행위 전환**

Actor는 상태에 따라 행위를 바꿀 수 있습니다:

```cpp
// 상태에 따라 다른 행위
behavior normal_state(stateful_actor<player_state>* self) {
  return {
    [=](damage_atom, int amount) {
      self->state.health -= amount;
      if (self->state.health <= 0) {
        self->become(dead_state(self));  // 행위 전환!
      }
    }
  };
}

behavior dead_state(stateful_actor<player_state>* self) {
  return {
    [=](damage_atom, int) {
      // 죽은 상태에서는 데미지 무시
    },
    [=](revive_atom) {
      self->state.health = 100;
      self->become(normal_state(self));  // 부활!
    }
  };
}
```

### 3. Mailbox (메시지 큐)

```
┌─────────────────────────────────────────────────────────────┐
│                      Mailbox 동작                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  외부에서 메시지 전송                                        │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────┐                           │
│  │ Mailbox (FIFO Queue)        │                           │
│  │ ┌─────┬─────┬─────┬─────┐  │                           │
│  │ │ M1  │ M2  │ M3  │ M4  │ ◀── 새 메시지는 뒤에 추가      │
│  │ └─────┴─────┴─────┴─────┘  │                           │
│  │   ▲                         │                           │
│  │   │ 순서대로 처리            │                           │
│  └───┼─────────────────────────┘                           │
│      │                                                      │
│      ▼                                                      │
│  ┌─────────────────────┐                                   │
│  │    Actor 처리       │                                   │
│  │    (한 번에 하나)    │                                   │
│  └─────────────────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Mailbox의 특성:**
- 기본적으로 **FIFO (First-In-First-Out)**
- 메시지 도착 순서대로 처리
- 한 번에 하나의 메시지만 처리 → **스레드 안전**
- 오버플로우 정책 설정 가능 (버리기, 대기, 백프레셔)

---

## 메시지 패싱 패턴

### Tell (Fire-and-Forget)

응답을 기다리지 않고 메시지를 보냅니다.

```go
// Go Proto.Actor
pid.Tell(&MoveCommand{X: 10, Y: 20})  // 보내고 바로 리턴
```

```
Actor A                    Actor B
   │                          │
   │──── Tell(msg) ──────────▶│
   │                          │
   │  (응답 기다리지 않음)      │
   ▼                          ▼
```

### Ask (Request-Response)

응답을 기다립니다.

```csharp
// C# Orleans
var player = client.GetGrain<IPlayerGrain>("player-1");
int health = await player.GetHealth();  // 응답 대기
```

```
Actor A                    Actor B
   │                          │
   │──── Ask(msg) ───────────▶│
   │                          │
   │◀─── Response ────────────│
   │                          │
   ▼                          ▼
```

### Forward

메시지를 다른 Actor에게 전달합니다.

```scala
// Scala Akka
def receive = {
  case msg: GameCommand =>
    gameLogicActor.forward(msg)  // 원래 sender 유지
}
```

---

## 예제 코드: Counter Actor

### TypeScript

```typescript
interface Message {
  type: string;
  payload?: any;
}

class CounterActor {
  private count: number = 0;

  receive(msg: Message): any {
    switch (msg.type) {
      case 'INCREMENT':
        this.count++;
        break;
      case 'DECREMENT':
        this.count--;
        break;
      case 'GET':
        return this.count;
      case 'RESET':
        this.count = 0;
        break;
    }
  }
}
```

### C++

```cpp
#include <caf/all.hpp>

using increment_atom = caf::atom_constant<caf::atom("inc")>;
using decrement_atom = caf::atom_constant<caf::atom("dec")>;
using get_atom = caf::atom_constant<caf::atom("get")>;

caf::behavior counter_actor(caf::stateful_actor<int>* self) {
  self->state = 0;

  return {
    [=](increment_atom) {
      self->state++;
    },
    [=](decrement_atom) {
      self->state--;
    },
    [=](get_atom) {
      return self->state;
    }
  };
}
```

### C#

```csharp
public interface ICounterGrain : IGrainWithIntegerKey
{
    Task Increment();
    Task Decrement();
    Task<int> GetCount();
}

public class CounterGrain : Grain, ICounterGrain
{
    private int _count = 0;

    public Task Increment()
    {
        _count++;
        return Task.CompletedTask;
    }

    public Task Decrement()
    {
        _count--;
        return Task.CompletedTask;
    }

    public Task<int> GetCount()
    {
        return Task.FromResult(_count);
    }
}
```

### Go

```go
type CounterActor struct {
    count int
}

type Increment struct{}
type Decrement struct{}
type GetCount struct{}
type CountResponse struct{ Value int }

func (c *CounterActor) Receive(ctx actor.Context) {
    switch ctx.Message().(type) {
    case *Increment:
        c.count++
    case *Decrement:
        c.count--
    case *GetCount:
        ctx.Respond(&CountResponse{Value: c.count})
    }
}
```

---

## 심화 주제

| 주제 | 설명 | 링크 |
|------|------|------|
| Actor 생명주기 | 생성, 시작, 재시작, 종료 | [actor.md](./actor.md) |
| 메시지 패싱 심화 | 라우팅, 브로드캐스트, 패턴 | [message-passing.md](./message-passing.md) |
| Mailbox 구현 | 큐 타입, 우선순위, 백프레셔 | [mailbox.md](./mailbox.md) |
| Become/Unbecome | FSM 패턴, 상태 전이 | [state-behavior.md](./state-behavior.md) |
| 위치 투명성 | 로컬/원격 통신, 클러스터링 | [location-transparency.md](./location-transparency.md) |

---

## 다음 단계

- [03. Actor vs Threads](../03-actor-vs-threads/README.md) - 스레드 모델과의 상세 비교
- [04. Supervision](../04-supervision/README.md) - 장애 복구와 감독 트리
