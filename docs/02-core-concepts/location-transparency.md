# 위치 투명성 (Location Transparency)

> 분산 환경에서 Actor의 물리적 위치를 추상화하는 개념

## 개요

위치 투명성(Location Transparency)은 Actor에게 메시지를 보낼 때 해당 Actor가 로컬에 있든 원격 서버에 있든 **동일한 방식으로 통신**할 수 있음을 의미합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Location Transparency                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   호출자 코드:                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  actor.send(message)  // 동일한 API                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│                           │                                      │
│              ┌────────────┴────────────┐                        │
│              │                         │                        │
│              ▼                         ▼                        │
│   ┌─────────────────┐       ┌─────────────────┐                │
│   │   Local Actor   │       │  Remote Actor   │                │
│   │   (Same JVM)    │       │ (Other Server)  │                │
│   └─────────────────┘       └─────────────────┘                │
│                                                                  │
│   개발자는 Actor의 물리적 위치를 신경 쓸 필요 없음              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 왜 중요한가?

### 1. 확장성 (Scalability)

```
┌─────────────────────────────────────────────────────────────────┐
│                     Scale-Out Example                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   초기 상태 (단일 서버):                                         │
│   ┌─────────────────────────────────────────┐                   │
│   │              Server 1                    │                   │
│   │   [Actor A] [Actor B] [Actor C]         │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                  │
│   확장 후 (다중 서버):                                           │
│   ┌──────────────────┐  ┌──────────────────┐                   │
│   │    Server 1      │  │    Server 2      │                   │
│   │   [Actor A]      │  │ [Actor B] [C]    │                   │
│   └──────────────────┘  └──────────────────┘                   │
│                                                                  │
│   코드 변경 없이 Actor 재배치 가능!                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. 장애 격리 (Fault Isolation)

```
서버 1 장애 발생 시:

┌──────────────────┐  ┌──────────────────┐
│    Server 1      │  │    Server 2      │
│   [Actor A] ✗    │  │ [Actor B] [C] ✓  │
│   (장애)         │  │ (정상 동작)      │
└──────────────────┘  └──────────────────┘

→ Actor B, C는 Actor A의 장애와 독립적으로 동작
→ Actor A만 다른 서버에서 재생성 가능
```

### 3. 유연한 배포 (Flexible Deployment)

개발 환경과 프로덕션 환경에서 동일한 코드 사용:

```yaml
# 개발 환경: 단일 프로세스
deployment:
  mode: local
  actors: all-in-one

# 프로덕션 환경: 분산 클러스터
deployment:
  mode: cluster
  nodes:
    - host: server1
      actors: [OrderActor, PaymentActor]
    - host: server2
      actors: [InventoryActor, ShippingActor]
```

## Actor Reference (ActorRef)

위치 투명성을 구현하는 핵심은 **ActorRef**입니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                      ActorRef Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ActorRef                                                       │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  • 논리적 주소 (Logical Address)                         │   │
│   │  • 물리적 위치 추상화                                    │   │
│   │  • 직렬화 가능 (네트워크 전송 가능)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Message Dispatcher                     │   │
│   │                                                          │   │
│   │  로컬 Actor? ──▶ 직접 전달                              │   │
│   │  원격 Actor? ──▶ 네트워크로 직렬화하여 전송              │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Akka ActorRef 예시

```scala
// Actor 경로 예시
val localRef = system.actorOf(Props[MyActor], "myActor")
// 경로: akka://MySystem/user/myActor

val remoteRef = system.actorSelection(
  "akka://MySystem@server2:2552/user/myActor"
)
// 원격 Actor도 동일한 방식으로 메시지 전송

// 로컬이든 원격이든 동일한 API
localRef ! Message("hello")
remoteRef ! Message("hello")
```

### Orleans GrainReference 예시

```csharp
// Grain 참조 획득 - 위치 무관
var playerGrain = client.GetGrain<IPlayerGrain>(playerId);

// 메시지 전송 - 어느 서버에 있든 동일
await playerGrain.UpdateScore(100);

// Orleans가 자동으로:
// 1. Grain이 어느 Silo에 있는지 확인
// 2. 없으면 적절한 Silo에서 활성화
// 3. 메시지 라우팅
```

## 주소 체계

### Akka Actor Path

```
akka://SystemName@host:port/user/parent/child

┌──────────────────────────────────────────────────────────────┐
│  akka://  │ MySystem │ @server:2552 │ /user/orders/order123 │
│           │          │              │                        │
│  프로토콜 │ 시스템명 │   위치정보   │      Actor 경로       │
└──────────────────────────────────────────────────────────────┘
```

### Erlang Process Identifier (PID)

```erlang
%% 로컬 PID
<0.42.0>

%% 원격 PID (노드 정보 포함)
<remote_node@host.42.0>

%% 이름으로 등록
register(my_actor, Pid).
whereis(my_actor).  % PID 반환
```

### Orleans Grain Identity

```csharp
// Grain 타입 + Primary Key로 식별
IPlayerGrain player = client.GetGrain<IPlayerGrain>("player-123");

// 복합 키 사용
IGameGrain game = client.GetGrain<IGameGrain>(gameId, region);
```

## 클러스터 구성

### Akka Cluster

```hocon
akka {
  actor {
    provider = cluster
  }

  remote.artery {
    canonical {
      hostname = "127.0.0.1"
      port = 2551
    }
  }

  cluster {
    seed-nodes = [
      "akka://MySystem@127.0.0.1:2551",
      "akka://MySystem@127.0.0.1:2552"
    ]
  }
}
```

```scala
// 클러스터 내 Actor 조회
val cluster = Cluster(system)

// Cluster Singleton
val singletonManager = ClusterSingletonManager.props(
  singletonProps = Props[MySingletonActor],
  terminationMessage = End,
  settings = ClusterSingletonManagerSettings(system)
)

// Cluster Sharding
val sharding = ClusterSharding(system)
sharding.start(
  typeName = "Counter",
  entityProps = Props[CounterActor],
  settings = ClusterShardingSettings(system),
  extractEntityId = extractEntityId,
  extractShardId = extractShardId
)
```

### Orleans Silo Cluster

```csharp
// Silo 구성
var builder = new HostBuilder()
    .UseOrleans(siloBuilder =>
    {
        siloBuilder
            .UseAzureStorageClustering(options =>
            {
                options.ConnectionString = connectionString;
            })
            .Configure<ClusterOptions>(options =>
            {
                options.ClusterId = "my-cluster";
                options.ServiceId = "my-service";
            });
    });
```

## 메시지 라우팅

```
┌─────────────────────────────────────────────────────────────────┐
│                    Message Routing Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   1. 메시지 전송 요청                                            │
│      actorRef ! message                                         │
│              │                                                   │
│              ▼                                                   │
│   2. ActorRef가 위치 확인                                        │
│      ┌─────────────────────────────────────────┐                │
│      │  로컬? ──▶ 바로 Mailbox에 enqueue       │                │
│      │  원격? ──▶ 직렬화 후 네트워크 전송      │                │
│      └─────────────────────────────────────────┘                │
│              │                                                   │
│              ▼                                                   │
│   3. 원격 전송 시                                                │
│      ┌─────────────────────────────────────────┐                │
│      │  • 메시지 직렬화 (Protobuf, JSON 등)    │                │
│      │  • TCP/UDP 전송                         │                │
│      │  • 원격 노드에서 역직렬화               │                │
│      │  • 대상 Actor의 Mailbox에 enqueue       │                │
│      └─────────────────────────────────────────┘                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 직렬화

원격 통신을 위해 메시지는 직렬화 가능해야 합니다:

```scala
// Akka - 직렬화 설정
akka {
  actor {
    serializers {
      jackson-json = "akka.serialization.jackson.JacksonJsonSerializer"
      proto = "akka.remote.serialization.ProtobufSerializer"
    }

    serialization-bindings {
      "com.example.MyMessage" = jackson-json
      "com.google.protobuf.Message" = proto
    }
  }
}
```

```csharp
// Orleans - 자동 직렬화 (기본 제공)
[GenerateSerializer]
public class PlayerState
{
    [Id(0)]
    public string Name { get; set; }

    [Id(1)]
    public int Level { get; set; }
}
```

## 주의사항

### 1. 네트워크 지연

```
로컬 호출:    ~나노초
원격 호출:    ~밀리초 (1000배+ 차이)

→ 성능이 중요한 경우 Actor 배치 전략 고려 필요
```

### 2. 부분 장애

```
분산 환경에서는 네트워크 파티션 발생 가능:

Server 1 ──✗── Server 2

→ 메시지 유실 가능성 존재
→ At-least-once / At-most-once 전달 보장 선택
```

### 3. 메시지 순서

```
로컬: 순서 보장 (단일 발신자 → 단일 수신자)
원격: 일반적으로 순서 보장되나, 프레임워크마다 다름

Actor A ──msg1──▶ Actor B  (순서 보장)
         ──msg2──▶

Actor A ──msg1──▶ Actor B
Actor C ──msg2──▶          (순서 보장 안됨)
```

## 관련 문서

- [메시지 패싱](./message-passing.md)
- [Actor 개념](./actor.md)
- [프레임워크 비교](../05-frameworks/README.md)
