# Proto.Actor

> 크로스 플랫폼 고성능 Actor 프레임워크

## 개요

Proto.Actor는 Go, C#, Kotlin에서 사용 가능한 크로스 플랫폼 Actor 프레임워크입니다. gRPC를 기반으로 하여 언어 간 통신을 지원합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   Proto.Actor Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                    Proto.Actor                            │  │
│   │                                                           │  │
│   │   ┌─────────┐   ┌─────────┐   ┌─────────┐               │  │
│   │   │   Go    │   │   C#    │   │ Kotlin  │               │  │
│   │   └────┬────┘   └────┬────┘   └────┬────┘               │  │
│   │        │             │             │                     │  │
│   │        └─────────────┼─────────────┘                     │  │
│   │                      │                                    │  │
│   │              ┌───────┴───────┐                           │  │
│   │              │     gRPC      │                           │  │
│   │              │  (Protocol)   │                           │  │
│   │              └───────────────┘                           │  │
│   │                                                           │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Go 예시

### 기본 Actor

```go
package main

import (
    "fmt"
    "github.com/asynkron/protoactor-go/actor"
)

// 메시지 타입
type Hello struct{ Who string }
type HelloResponse struct{ Message string }

// Actor 구현
type HelloActor struct{}

func (h *HelloActor) Receive(ctx actor.Context) {
    switch msg := ctx.Message().(type) {
    case *Hello:
        response := &HelloResponse{
            Message: fmt.Sprintf("Hello, %s!", msg.Who),
        }
        ctx.Respond(response)
    }
}

func main() {
    system := actor.NewActorSystem()
    props := actor.PropsFromProducer(func() actor.Actor {
        return &HelloActor{}
    })

    pid := system.Root.Spawn(props)

    // Fire and forget
    system.Root.Send(pid, &Hello{Who: "World"})

    // Request-Response
    future := system.Root.RequestFuture(pid, &Hello{Who: "Proto.Actor"}, 5*time.Second)
    result, _ := future.Result()
    fmt.Println(result.(*HelloResponse).Message)
}
```

### Supervision

```go
type ParentActor struct {
    child *actor.PID
}

func (p *ParentActor) Receive(ctx actor.Context) {
    switch ctx.Message().(type) {
    case *actor.Started:
        props := actor.PropsFromProducer(func() actor.Actor {
            return &ChildActor{}
        }).WithSupervisor(
            actor.NewOneForOneStrategy(10, time.Minute, decider),
        )
        p.child = ctx.Spawn(props)
    }
}

func decider(reason interface{}) actor.Directive {
    switch reason.(type) {
    case *CustomError:
        return actor.RestartDirective
    default:
        return actor.EscalateDirective
    }
}
```

## C# 예시

```csharp
using Proto;

// 메시지
public record Hello(string Who);
public record HelloResponse(string Message);

// Actor
public class HelloActor : IActor
{
    public Task ReceiveAsync(IContext context)
    {
        switch (context.Message)
        {
            case Hello hello:
                context.Respond(new HelloResponse($"Hello, {hello.Who}!"));
                break;
        }
        return Task.CompletedTask;
    }
}

// 사용
var system = new ActorSystem();
var props = Props.FromProducer(() => new HelloActor());
var pid = system.Root.Spawn(props);

var response = await system.Root.RequestAsync<HelloResponse>(
    pid,
    new Hello("Proto.Actor"),
    TimeSpan.FromSeconds(5)
);
Console.WriteLine(response.Message);
```

## Cluster

```go
// Go Cluster 설정
import (
    "github.com/asynkron/protoactor-go/cluster"
    "github.com/asynkron/protoactor-go/cluster/consul"
)

func main() {
    system := actor.NewActorSystem()

    provider, _ := consul.New()
    config := cluster.Configure("my-cluster", provider,
        cluster.WithKinds(
            cluster.NewKind("HelloKind", actor.PropsFromProducer(func() actor.Actor {
                return &HelloActor{}
            })),
        ),
    )

    c := cluster.New(system, config)
    c.StartMember()

    // 클러스터 내 Actor 호출
    grain := cluster.GetCluster(system).Get("hello-1", "HelloKind")
    response, _ := grain.RequestFuture(&Hello{Who: "Cluster"}, 5*time.Second).Result()
}
```

## Virtual Actor (Grain)

Proto.Actor도 Virtual Actor 패턴 지원:

```go
// grain.proto
syntax = "proto3";
package grains;

service HelloGrain {
    rpc SayHello(HelloRequest) returns (HelloResponse);
}

message HelloRequest { string name = 1; }
message HelloResponse { string message = 1; }
```

```go
// Grain 구현
type HelloGrain struct {
    grains.HelloGrainBase
}

func (h *HelloGrain) SayHello(req *HelloRequest, ctx cluster.GrainContext) (*HelloResponse, error) {
    return &HelloResponse{
        Message: fmt.Sprintf("Hello, %s!", req.Name),
    }, nil
}

// 호출
client := grains.GetHelloGrainClient(cluster, "grain-1")
response, _ := client.SayHello(&HelloRequest{Name: "World"})
```

## 장단점

### 장점

| 장점 | 설명 |
|------|------|
| 크로스 플랫폼 | Go, C#, Kotlin 지원 |
| 고성능 | 경량 Actor, gRPC 기반 |
| gRPC 통합 | 표준 프로토콜 사용 |
| Virtual Actor | Grain 패턴 지원 |
| 오픈소스 | Apache 2.0 |

### 단점

| 단점 | 설명 |
|------|------|
| 커뮤니티 | Akka 대비 작음 |
| 문서화 | 상대적으로 부족 |
| 생태계 | 통합 라이브러리 적음 |

## 사용 사례

- 마이크로서비스 간 통신
- 다중 언어 환경
- 고성능 분산 시스템
- gRPC 기반 서비스

## 관련 문서

- [프레임워크 비교](./comparison-table.md)
- [Akka](./akka.md)
- [Orleans](./orleans.md)
