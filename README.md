# Actor Model 완벽 가이드

> 동시성 프로그래밍의 새로운 패러다임, Actor Model을 기초부터 게임 서버 적용까지 학습하는 레포지토리

## Actor Model이란?

**Actor Model**은 1973년 Carl Hewitt가 제안한 동시성 프로그래밍 모델입니다. 모든 것을 **Actor**라는 독립적인 개체로 모델링하며, Actor들은 오직 **메시지 패싱**을 통해서만 통신합니다.

```
┌─────────────────────────────────────────────────────────────┐
│                        Actor Model                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐    메시지    ┌─────────┐    메시지    ┌─────────┐
│   │ Actor A │ ──────────▶ │ Actor B │ ──────────▶ │ Actor C │
│   │         │             │         │             │         │
│   │ [State] │             │ [State] │             │ [State] │
│   │ [Mailbox]             │ [Mailbox]             │ [Mailbox]
│   └─────────┘             └─────────┘             └─────────┘
│                                                             │
│   • 각 Actor는 독립적인 상태(State)를 가짐                    │
│   • 공유 메모리 없음 → Lock 불필요                            │
│   • 메시지는 Mailbox에 순차적으로 처리                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 핵심 원칙 (30초 요약)

| 원칙 | 설명 |
|------|------|
| **격리 (Isolation)** | 각 Actor는 자신만의 상태를 가지며 외부에서 직접 접근 불가 |
| **메시지 패싱 (Message Passing)** | Actor 간 통신은 오직 비동기 메시지로만 가능 |
| **순차 처리 (Sequential Processing)** | 각 Actor는 메시지를 한 번에 하나씩 처리 |
| **위치 투명성 (Location Transparency)** | Actor가 로컬/원격 어디에 있든 동일하게 통신 |

---

## 목차

### 기초 개념
- [01. Introduction](./docs/01-introduction/README.md) - Actor Model 소개 및 역사
- [02. Core Concepts](./docs/02-core-concepts/README.md) - Actor, Message, Mailbox 핵심 개념
- [03. Actor vs Threads](./docs/03-actor-vs-threads/README.md) - 전통적 스레드 모델과의 비교

### 심화 개념
- [04. Supervision](./docs/04-supervision/README.md) - 감독 트리와 장애 복구 (Let it Crash)
- [05. Frameworks](./docs/05-frameworks/README.md) - 주요 프레임워크 비교 (Akka, Orleans, Erlang)

### 게임 서버 적용
- [06. Game Server](./docs/06-game-server/README.md) - 게임 서버 적용 사례 및 가이드
- [07. Real-time Game](./docs/07-realtime-game/README.md) - 실시간 게임서버 적합성 분석
- [08. Web Server](./docs/08-web-server/README.md) - 비실시간(웹서버) 적합성 분석

### 추가 학습
- [09. Open Source](./docs/09-open-source/README.md) - 분석할 오픈소스 레포지토리

---

## 빠른 시작: Hello Actor

### TypeScript (Comedy 라이브러리)

```typescript
import { Actor, ActorSystem } from 'comedy';

// Actor 정의
class GreeterActor {
  private greeting: string = 'Hello';

  // 메시지 핸들러
  async greet(name: string): Promise<string> {
    return `${this.greeting}, ${name}!`;
  }

  // 상태 변경
  async setGreeting(newGreeting: string): Promise<void> {
    this.greeting = newGreeting;
  }
}

// Actor 시스템 생성 및 사용
async function main() {
  const system = new ActorSystem();
  const greeter = await system.createActor(GreeterActor);

  const response = await greeter.send('greet', 'World');
  console.log(response); // "Hello, World!"
}
```

### C++ (CAF - C++ Actor Framework)

```cpp
#include <caf/all.hpp>
using namespace caf;

// 메시지 타입 정의
using greet_atom = atom_constant<atom("greet")>;

// Actor 행위 정의
behavior greeter(event_based_actor* self) {
  return {
    [](greet_atom, const std::string& name) {
      return "Hello, " + name + "!";
    }
  };
}

void caf_main(actor_system& sys) {
  auto greeter_actor = sys.spawn(greeter);

  // 메시지 전송
  scoped_actor self{sys};
  self->request(greeter_actor, infinite, greet_atom_v, "World")
    .receive(
      [](const std::string& response) {
        aout(self) << response << std::endl;  // "Hello, World!"
      },
      [](error& err) { /* 에러 처리 */ }
    );
}

CAF_MAIN()
```

### C# (Microsoft Orleans)

```csharp
// Grain 인터페이스 정의
public interface IGreeterGrain : IGrainWithStringKey
{
    Task<string> Greet(string name);
    Task SetGreeting(string greeting);
}

// Grain 구현
public class GreeterGrain : Grain, IGreeterGrain
{
    private string _greeting = "Hello";

    public Task<string> Greet(string name)
    {
        return Task.FromResult($"{_greeting}, {name}!");
    }

    public Task SetGreeting(string greeting)
    {
        _greeting = greeting;
        return Task.CompletedTask;
    }
}

// 사용
var greeter = client.GetGrain<IGreeterGrain>("greeter-1");
var response = await greeter.Greet("World");
Console.WriteLine(response);  // "Hello, World!"
```

### Go (Proto.Actor)

```go
package main

import (
    "fmt"
    "github.com/asynkron/protoactor-go/actor"
)

// 메시지 타입
type Greet struct{ Name string }
type GreetResponse struct{ Message string }

// Actor 정의
type GreeterActor struct {
    greeting string
}

func (g *GreeterActor) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *Greet:
        response := fmt.Sprintf("%s, %s!", g.greeting, msg.Name)
        ctx.Respond(&GreetResponse{Message: response})
    }
}

func main() {
    system := actor.NewActorSystem()
    props := actor.PropsFromProducer(func() actor.Actor {
        return &GreeterActor{greeting: "Hello"}
    })

    pid := system.Root.Spawn(props)
    future := system.Root.RequestFuture(pid, &Greet{Name: "World"}, 5*time.Second)

    result, _ := future.Result()
    fmt.Println(result.(*GreetResponse).Message)  // "Hello, World!"
}
```

---

## 왜 Actor Model인가?

### 전통적 스레드 모델의 문제점

```
❌ 공유 메모리 + Lock = 복잡성 폭발
   • Race Condition
   • Deadlock
   • Priority Inversion
   • 디버깅 지옥

✅ Actor Model = 단순함
   • 공유 상태 없음
   • Lock 불필요
   • 메시지 순차 처리
   • 장애 격리
```

### 언제 Actor Model을 사용해야 하는가?

| 적합한 경우 | 부적합한 경우 |
|-------------|---------------|
| 높은 동시성 (수천~수백만 연결) | 단순한 순차 처리 |
| 분산 시스템 | 강한 트랜잭션 요구 |
| 장애 허용이 중요한 시스템 | 단일 스레드로 충분한 경우 |
| 게임 서버, 채팅 서버 | 배치 처리 시스템 |
| IoT 디바이스 관리 | 계산 집약적 작업 |

---

## 실제 적용 사례

### 게임 산업

| 게임/회사 | 사용 기술 | 적용 영역 |
|-----------|-----------|-----------|
| **Halo 4, 5** | Orleans | 전체 백엔드 서비스 |
| **EVE Online** | Stackless Python | 우주 시뮬레이션, Time Dilation |
| **Destiny** | Erlang 기반 | 매치메이킹, 세션 관리 |

### 기타 산업

| 회사 | 사용 기술 | 적용 영역 |
|------|-----------|-----------|
| **WhatsApp** | Erlang | 메시징 서버 (1000만+ 동시 연결) |
| **Discord** | Elixir | 실시간 채팅 |
| **LinkedIn** | Akka | 실시간 알림 시스템 |

---

## 프레임워크 선택 가이드

```
어떤 언어를 사용하나요?
│
├─ JVM (Java/Scala/Kotlin)
│   └─ ✅ Akka
│
├─ .NET (C#/F#)
│   ├─ 간단한 시작 원함 → ✅ Orleans (Virtual Actor)
│   └─ 세밀한 제어 원함 → ✅ Akka.NET
│
├─ C++
│   └─ ✅ CAF (C++ Actor Framework)
│
├─ Go
│   └─ ✅ Proto.Actor
│
├─ Erlang/Elixir
│   └─ ✅ OTP (내장)
│
└─ 여러 언어 혼용
    └─ ✅ Proto.Actor (gRPC 기반 크로스 플랫폼)
```

→ 자세한 비교는 [05. Frameworks](./docs/05-frameworks/README.md) 참조

---

## 예제 코드

| 예제 | 설명 | 난이도 |
|------|------|--------|
| [01-basic-actor](./examples/01-basic-actor/) | Counter Actor 기본 구현 | ⭐ 초급 |
| [02-message-passing](./examples/02-message-passing/) | Ask/Tell 패턴 | ⭐ 초급 |
| [03-supervision](./examples/03-supervision/) | 감독 트리와 장애 복구 | ⭐⭐ 중급 |
| [04-game-room](./examples/04-game-room/) | 멀티플레이어 게임룸 | ⭐⭐ 중급 |
| [05-chat-server](./examples/05-chat-server/) | 채팅 서버 | ⭐⭐ 중급 |
| [06-mmorpg](./examples/06-mmorpg/) | MMORPG Zone/Shard 아키텍처 | ⭐⭐⭐ 고급 |

---

## 참고 자료

### 공식 문서
- [Akka Documentation](https://doc.akka.io/)
- [Orleans Documentation](https://learn.microsoft.com/en-us/dotnet/orleans/)
- [Erlang OTP](https://www.erlang.org/doc/design_principles/des_princ.html)
- [CAF - C++ Actor Framework](https://www.actor-framework.org/)

### 추천 읽을거리
- [The Actor Model in 10 minutes](https://www.brianstorti.com/the-actor-model/)
- [Akka.NET - What problems does actor model solve?](https://getakka.net/articles/intro/what-problems-does-actor-model-solve.html)

### 오픈소스 분석
- [mir2x](https://github.com/etorth/mir2x) - C++20 Actor 기반 MMORPG
- [NoahGameFrame](https://github.com/ketoo/NoahGameFrame) - C++ Actor 게임 서버 프레임워크
- [Orleans](https://github.com/dotnet/orleans) - Microsoft Virtual Actor

→ 자세한 분석은 [09. Open Source](./docs/09-open-source/README.md) 참조

---

## 기여하기

이 레포지토리는 학습 목적으로 만들어졌습니다. 오류 수정, 내용 추가, 번역 등 모든 기여를 환영합니다!

---

## 라이선스

MIT License
