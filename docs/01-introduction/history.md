# Actor Model의 역사

> 1973년 인공지능 연구에서 시작된 Actor Model이 어떻게 현대 분산 시스템의 핵심 패러다임이 되었는지 알아봅니다.

## 타임라인

```
1973 ──── Carl Hewitt, Actor Model 제안 (MIT AI Lab)
   │
1986 ──── Erlang 개발 시작 (Ericsson)
   │
1987 ──── Erlang 첫 버전 출시
   │
1998 ──── Erlang 오픈소스화
   │
2009 ──── Akka 프로젝트 시작 (Scala/Java)
   │
2010 ──── Orleans 연구 시작 (Microsoft Research)
   │
2012 ──── Elixir 1.0 출시
   │
2014 ──── Orleans 오픈소스화
   │
2015 ──── Akka.NET 출시
   │
현재 ──── Actor Model, 클라우드 네이티브 시대의 핵심 패턴
```

---

## 1973: 탄생 - Carl Hewitt의 비전

### 배경

1970년대 초, MIT 인공지능 연구소에서 **Carl Hewitt**, **Peter Bishop**, **Richard Steiger**는 인공지능 시스템의 동시성 문제를 연구하고 있었습니다.

기존의 순차적 프로그래밍 모델로는 다음과 같은 문제를 해결할 수 없었습니다:
- 여러 에이전트가 동시에 작동하는 AI 시스템
- 분산된 지식 베이스
- 비동기적으로 도착하는 정보 처리

### Actor Model의 탄생

1973년 논문 **"A Universal Modular Actor Formalism for Artificial Intelligence"**에서 Hewitt는 혁명적인 아이디어를 제시했습니다:

```
"모든 것은 Actor이다"

Actor는 다음 세 가지만 할 수 있다:
1. 유한한 수의 메시지를 다른 Actor에게 보낸다
2. 유한한 수의 새로운 Actor를 생성한다
3. 다음 메시지를 받았을 때의 행동을 지정한다
```

### 핵심 통찰

Hewitt의 모델은 물리학의 영향을 받았습니다:

```
물리적 세계                          Actor Model
─────────────────────────────────────────────────────
입자 (particle)          →          Actor
입자 간 상호작용          →          메시지 패싱
국소성 (locality)        →          캡슐화된 상태
인과율 (causality)       →          메시지 순서
```

> "물리적 세계에서 입자들이 직접 상태를 공유하지 않고 힘(메시지)을 통해 상호작용하는 것처럼, Actor도 메시지를 통해서만 통신한다."

---

## 1986-1998: Erlang의 등장

### Ericsson의 도전

1980년대 Ericsson은 전화 교환기 시스템 개발에서 심각한 문제에 직면했습니다:

```
통신 시스템 요구사항:
─────────────────────
• 99.9999999% 가용성 (연간 31ms 다운타임)
• 수백만 동시 통화 처리
• 무중단 업그레이드
• 하드웨어 장애 시에도 서비스 지속
```

기존의 C/C++ 기반 시스템으로는 이러한 요구사항을 충족하기 어려웠습니다.

### Joe Armstrong과 Erlang

**Joe Armstrong**, **Robert Virding**, **Mike Williams**는 새로운 언어를 설계했습니다:

```erlang
%% Erlang의 Actor (Process)
-module(counter).
-export([start/0, increment/1, get/1]).

start() ->
    spawn(fun() -> loop(0) end).

loop(Count) ->
    receive
        {increment, From} ->
            From ! {ok, Count + 1},
            loop(Count + 1);
        {get, From} ->
            From ! {value, Count},
            loop(Count)
    end.
```

### Erlang의 혁신

```
┌─────────────────────────────────────────────────────────────┐
│                    Erlang의 핵심 철학                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  "Let it Crash" 철학                                        │
│  ─────────────────                                          │
│  • 에러를 숨기지 말고, 프로세스를 죽게 두어라                  │
│  • Supervisor가 자동으로 재시작                              │
│  • 복잡한 방어적 코딩 불필요                                  │
│                                                             │
│  경량 프로세스                                               │
│  ────────────                                               │
│  • 수백만 개의 프로세스 동시 실행 가능                        │
│  • 프로세스당 ~300 바이트 메모리                             │
│  • OS 스레드가 아닌 VM 레벨 스케줄링                         │
│                                                             │
│  핫 코드 스와핑                                              │
│  ─────────────                                              │
│  • 시스템 중단 없이 코드 업데이트                             │
│  • 전화 통화 중에도 시스템 업그레이드 가능                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1998년 오픈소스화

Ericsson이 Erlang을 오픈소스로 공개하면서:
- AXD301 ATM 스위치: 99.9999999% 가용성 달성
- 전 세계 통신 인프라의 핵심 기술로 자리잡음

---

## 2009-현재: 현대적 Actor 프레임워크

### Akka (2009, JVM)

Scala 생태계에서 탄생한 Akka는 Actor Model을 JVM에 가져왔습니다:

```scala
// Akka Actor 예시
class CounterActor extends Actor {
  var count = 0

  def receive = {
    case Increment => count += 1
    case GetCount  => sender() ! count
  }
}
```

**특징:**
- 타입 안전한 Actor (Akka Typed)
- 클러스터링 내장
- Persistence (Event Sourcing)
- Streams API

### Orleans (2010, .NET)

Microsoft Research에서 개발한 Orleans는 **Virtual Actor** 개념을 도입:

```csharp
// Orleans Grain (Virtual Actor)
public class PlayerGrain : Grain, IPlayerGrain
{
    private PlayerState state;

    public Task<int> GetScore() => Task.FromResult(state.Score);
}

// 사용 - Actor가 자동으로 활성화됨
var player = client.GetGrain<IPlayerGrain>("player-123");
var score = await player.GetScore();
```

**Virtual Actor의 혁신:**
```
Traditional Actor              Virtual Actor (Orleans)
──────────────────────────────────────────────────────
명시적 생성/삭제 필요           자동 활성화/비활성화
수동 위치 관리                 자동 분산 배치
장애 시 수동 복구              자동 재활성화
```

### Elixir (2012)

Erlang VM 위에서 동작하는 현대적 언어:

```elixir
defmodule Counter do
  use GenServer

  def start_link(initial) do
    GenServer.start_link(__MODULE__, initial)
  end

  def increment(pid) do
    GenServer.cast(pid, :increment)
  end

  def handle_cast(:increment, count) do
    {:noreply, count + 1}
  end
end
```

**성공 사례:**
- Discord: 1억+ 사용자의 실시간 채팅
- Pinterest: 알림 시스템
- Moz: 웹 크롤러

---

## Actor Model의 진화

### 세대별 특징

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Actor Model의 세대별 진화                         │
├────────────────┬─────────────────┬───────────────────────────────────┤
│     세대       │    대표 기술     │           주요 특징               │
├────────────────┼─────────────────┼───────────────────────────────────┤
│ 1세대 (1970s)  │ 이론적 모델      │ 수학적 모델, 형식적 정의          │
│ 2세대 (1980s)  │ Erlang/OTP      │ 실용적 구현, 통신 시스템          │
│ 3세대 (2000s)  │ Akka            │ JVM 생태계, 타입 안전성           │
│ 4세대 (2010s)  │ Orleans         │ Virtual Actor, 클라우드 네이티브   │
│ 5세대 (현재)   │ Dapr, Proto     │ 다중 언어, 서비스 메시             │
└────────────────┴─────────────────┴───────────────────────────────────┘
```

---

## 현대적 적용

### 클라우드 네이티브 시대

Actor Model은 현대 클라우드 아키텍처와 자연스럽게 맞습니다:

```
Actor Model 특성              클라우드 네이티브 요구사항
────────────────────────────────────────────────────────
위치 투명성           →       컨테이너/Pod 이동성
장애 격리             →       서비스 격리
메시지 기반           →       이벤트 드리븐 아키텍처
상태 캡슐화           →       Stateful 서비스
자동 스케일링         →       탄력적 인프라
```

### 마이크로서비스와 Actor

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Service A  │     │  Service B  │     │  Service C  │
│  ┌───────┐  │     │  ┌───────┐  │     │  ┌───────┐  │
│  │ Actor │  │────▶│  │ Actor │  │────▶│  │ Actor │  │
│  └───────┘  │     │  └───────┘  │     │  └───────┘  │
│  ┌───────┐  │     │  ┌───────┐  │     │  ┌───────┐  │
│  │ Actor │  │     │  │ Actor │  │     │  │ Actor │  │
│  └───────┘  │     │  └───────┘  │     │  └───────┘  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       └───────────────────┴───────────────────┘
                           │
                    Message Bus / gRPC
```

---

## 주요 인물

| 인물 | 기여 | 시기 |
|------|------|------|
| **Carl Hewitt** | Actor Model 창시자 | 1973 |
| **Joe Armstrong** | Erlang 공동 창시자 | 1986 |
| **Jonas Bonér** | Akka 창시자 | 2009 |
| **Sergey Bykov** | Orleans 수석 설계자 | 2010 |
| **José Valim** | Elixir 창시자 | 2012 |

---

## 참고 자료

### 논문
- Hewitt, C. (1973). "A Universal Modular Actor Formalism for Artificial Intelligence"
- Armstrong, J. (2003). "Making reliable distributed systems in the presence of software errors"

### 책
- "Programming Erlang" - Joe Armstrong
- "Designing for Scalability with Erlang/OTP" - Cesarini & Vinoski
- "Akka in Action" - Raymond Roestenburg

### 영상
- [Hewitt, Meijer and Szyperski: The Actor Model](https://www.youtube.com/watch?v=7erJ1DV_Tlo)
- [Joe Armstrong - The Mess We're In](https://www.youtube.com/watch?v=lKXe3HUG2l4)
