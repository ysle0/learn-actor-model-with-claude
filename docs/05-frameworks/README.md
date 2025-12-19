# 05. Frameworks - 주요 프레임워크 비교

> Actor Model을 구현한 주요 프레임워크들을 비교하고 선택 가이드를 제공합니다.

## 프레임워크 한눈에 보기

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Actor 프레임워크 비교                             │
├──────────────┬──────────┬────────────┬───────────┬─────────────────┤
│   프레임워크  │   언어    │   Actor    │   성숙도  │     특징         │
│              │          │   타입     │          │                 │
├──────────────┼──────────┼────────────┼───────────┼─────────────────┤
│ Erlang/OTP   │ Erlang   │ Classic    │ ⭐⭐⭐⭐⭐ │ 원조, 통신 산업   │
│ Elixir       │ Elixir   │ Classic    │ ⭐⭐⭐⭐   │ Erlang VM, 현대적 │
│ Akka         │ Scala    │ Classic    │ ⭐⭐⭐⭐⭐ │ JVM 최강자        │
│ Akka.NET     │ C#/F#    │ Classic    │ ⭐⭐⭐⭐   │ Akka 포팅         │
│ Orleans      │ C#       │ Virtual    │ ⭐⭐⭐⭐   │ 자동 관리         │
│ Proto.Actor  │ Go/C#/.  │ Classic    │ ⭐⭐⭐     │ 크로스 플랫폼     │
│ CAF          │ C++      │ Classic    │ ⭐⭐⭐     │ 고성능            │
└──────────────┴──────────┴────────────┴───────────┴─────────────────┘
```

---

## 프레임워크 선택 가이드

```
어떤 환경인가요?
│
├─ JVM (Java/Scala/Kotlin)
│   └─ ✅ Akka
│       • 가장 성숙한 JVM Actor 프레임워크
│       • 풍부한 에코시스템 (Streams, HTTP, Cluster)
│
├─ .NET (C#/F#)
│   │
│   ├─ 분산 시스템, 쉬운 시작
│   │   └─ ✅ Orleans
│   │       • Virtual Actor (자동 생명주기 관리)
│   │       • Azure 통합 우수
│   │
│   └─ 세밀한 제어 필요
│       └─ ✅ Akka.NET
│           • Akka와 유사한 API
│           • 더 많은 제어권
│
├─ C++
│   └─ ✅ CAF (C++ Actor Framework)
│       • 고성능
│       • 게임 서버에 적합
│
├─ Go
│   └─ ✅ Proto.Actor
│       • 경량
│       • gRPC 기반 분산
│
├─ Erlang/Elixir
│   └─ ✅ OTP (내장)
│       • Actor Model의 원조
│       • "Let it Crash"의 본고장
│
└─ 여러 언어 혼용
    └─ ✅ Proto.Actor / Dapr
        • 언어 중립적
        • gRPC 통신
```

---

## Classic Actor vs Virtual Actor

```
┌─────────────────────────────────────────────────────────────────────┐
│              Classic Actor vs Virtual Actor                         │
├────────────────────────────┬────────────────────────────────────────┤
│      Classic Actor         │         Virtual Actor                  │
│   (Akka, Erlang, CAF)      │         (Orleans)                      │
├────────────────────────────┼────────────────────────────────────────┤
│                            │                                        │
│ • 명시적 생성/종료          │ • 자동 활성화/비활성화                  │
│   actor = spawn(MyActor)   │   grain = GetGrain<IPlayer>("id")      │
│   actor.stop()             │   (자동 관리)                          │
│                            │                                        │
│ • 수동 위치 관리            │ • 자동 배치                            │
│   cluster.send(node, msg)  │   (프레임워크가 결정)                   │
│                            │                                        │
│ • 명시적 장애 처리          │ • 자동 재활성화                        │
│   supervisor.strategy      │   (호출 시 필요하면 활성화)             │
│                            │                                        │
│ • 더 많은 제어권            │ • 더 쉬운 프로그래밍                   │
│ • 더 가파른 학습곡선        │ • 빠른 개발 속도                       │
│                            │                                        │
└────────────────────────────┴────────────────────────────────────────┘
```

---

## 프레임워크별 Hello World

### Erlang/OTP

```erlang
-module(greeter).
-behaviour(gen_server).
-export([start_link/0, greet/1]).
-export([init/1, handle_call/3]).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

greet(Name) ->
    gen_server:call(?MODULE, {greet, Name}).

init([]) ->
    {ok, #{}}.

handle_call({greet, Name}, _From, State) ->
    {reply, "Hello, " ++ Name ++ "!", State}.
```

### Akka (Scala)

```scala
import akka.actor.typed.{ActorSystem, Behavior}
import akka.actor.typed.scaladsl.Behaviors

object Greeter {
  sealed trait Command
  case class Greet(name: String, replyTo: ActorRef[String]) extends Command

  def apply(): Behavior[Command] = Behaviors.receive { (context, message) =>
    message match {
      case Greet(name, replyTo) =>
        replyTo ! s"Hello, $name!"
        Behaviors.same
    }
  }
}

@main def run(): Unit = {
  val system = ActorSystem(Greeter(), "greeter-system")
  // ...
}
```

### Orleans (C#)

```csharp
// Grain 인터페이스
public interface IGreeterGrain : IGrainWithStringKey
{
    Task<string> Greet(string name);
}

// Grain 구현
public class GreeterGrain : Grain, IGreeterGrain
{
    public Task<string> Greet(string name)
    {
        return Task.FromResult($"Hello, {name}!");
    }
}

// 사용
var greeter = client.GetGrain<IGreeterGrain>("greeter1");
var message = await greeter.Greet("World");
```

### CAF (C++)

```cpp
#include <caf/all.hpp>
using namespace caf;

behavior greeter(event_based_actor* self) {
  return {
    [](const std::string& name) {
      return "Hello, " + name + "!";
    }
  };
}

void caf_main(actor_system& sys) {
  auto greeter_actor = sys.spawn(greeter);
  scoped_actor self{sys};

  self->request(greeter_actor, infinite, "World")
    .receive(
      [](const std::string& response) {
        std::cout << response << std::endl;
      },
      [](error& err) { /* error handling */ }
    );
}

CAF_MAIN()
```

### Proto.Actor (Go)

```go
package main

import (
    "fmt"
    "github.com/asynkron/protoactor-go/actor"
)

type Greet struct{ Name string }
type GreetResponse struct{ Message string }

type GreeterActor struct{}

func (g *GreeterActor) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *Greet:
        ctx.Respond(&GreetResponse{
            Message: fmt.Sprintf("Hello, %s!", msg.Name),
        })
    }
}

func main() {
    system := actor.NewActorSystem()
    props := actor.PropsFromProducer(func() actor.Actor {
        return &GreeterActor{}
    })
    pid := system.Root.Spawn(props)

    future := system.Root.RequestFuture(pid, &Greet{Name: "World"}, 5*time.Second)
    result, _ := future.Result()
    fmt.Println(result.(*GreetResponse).Message)
}
```

---

## 성능 비교 (참고용)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    성능 벤치마크 (대략적)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  메시지 처리량 (msgs/sec, 단일 머신)                                 │
│  ────────────────────────────────────                               │
│  Erlang     ████████████████████████  ~10M                          │
│  Akka       ████████████████████████████████  ~50M                  │
│  CAF        ██████████████████████████████████████  ~100M           │
│  Proto.Actor ██████████████████████████  ~20M                       │
│  Orleans    ████████████████  ~5M                                   │
│                                                                     │
│  Actor 생성 속도 (actors/sec)                                        │
│  ──────────────────────────                                         │
│  Erlang     ████████████████████████████  ~1M                       │
│  Akka       ██████████████████████  ~500K                           │
│  Proto.Actor ████████████████████████████████  ~2M                  │
│                                                                     │
│  ※ 실제 성능은 워크로드와 환경에 따라 크게 다름                       │
│  ※ 마이크로벤치마크이며 실제 애플리케이션과 다를 수 있음               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 게임 서버 관점 추천

| 요구사항 | 추천 프레임워크 |
|----------|----------------|
| AAA MMO 서버 | Orleans, Akka |
| 소규모 인디 게임 | Proto.Actor, Akka.NET |
| 고성능 C++ 서버 | CAF, SObjectizer |
| 실시간 채팅 | Elixir/Phoenix |
| 클라우드 네이티브 | Orleans, Dapr |

---

## 심화 문서

| 프레임워크 | 상세 문서 |
|------------|-----------|
| Erlang/OTP | [erlang-otp.md](./erlang-otp.md) |
| Akka | [akka.md](./akka.md) |
| Akka.NET | [akka-net.md](./akka-net.md) |
| Orleans | [orleans.md](./orleans.md) |
| Proto.Actor | [proto-actor.md](./proto-actor.md) |
| 비교표 | [comparison-table.md](./comparison-table.md) |

---

## 다음 단계

- [06. Game Server](../06-game-server/README.md) - 게임 서버에 Actor Model 적용하기
- [09. Open Source](../09-open-source/README.md) - 오픈소스 분석
