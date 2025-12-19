# Actor Model 학습 레포지토리 - 프로젝트 계획서

## 📋 프로젝트 개요

이 레포지토리는 **Actor Model**에 대한 포괄적인 학습 자료를 제공합니다. 표면적인 개념부터 깊은 구현 세부사항까지 단계별로 학습할 수 있도록 구성됩니다.

### 목표
- Actor Model의 기본 개념부터 고급 패턴까지 체계적으로 학습
- 실제 동작하는 예제 코드 제공
- 게임 서버 개발에의 적용 사례 심층 분석
- 추가 학습을 위한 오픈소스 분석 가이드 제공

---

## 📁 문서 구조

```
learn-actor-model-with-claude/
├── README.md                          # 메인 페이지 (전체 개요 + 각 섹션 요약)
├── PLAN.md                            # 이 계획서
│
├── docs/
│   ├── 01-introduction/
│   │   ├── README.md                  # 소개 (간결한 설명)
│   │   ├── history.md                 # 역사 (1973년 Carl Hewitt부터)
│   │   └── why-actor-model.md         # 왜 Actor Model인가?
│   │
│   ├── 02-core-concepts/
│   │   ├── README.md                  # 핵심 개념 요약
│   │   ├── actor.md                   # Actor란 무엇인가
│   │   ├── message-passing.md         # 메시지 패싱
│   │   ├── mailbox.md                 # Mailbox 동작 원리
│   │   ├── state-behavior.md          # 상태와 행위
│   │   └── location-transparency.md   # 위치 투명성
│   │
│   ├── 03-actor-vs-threads/
│   │   ├── README.md                  # 비교 요약
│   │   ├── thread-problems.md         # 전통적 스레드 모델의 문제점
│   │   ├── lock-free.md               # Lock-Free 동시성
│   │   ├── performance-comparison.md  # 성능 비교
│   │   └── when-to-use.md             # 언제 Actor Model을 사용해야 하는가
│   │
│   ├── 04-supervision/
│   │   ├── README.md                  # 감독(Supervision) 개요
│   │   ├── supervision-tree.md        # 감독 트리 구조
│   │   ├── let-it-crash.md            # "Let it Crash" 철학
│   │   ├── restart-strategies.md      # 재시작 전략
│   │   └── fault-tolerance.md         # 장애 허용 시스템 설계
│   │
│   ├── 05-frameworks/
│   │   ├── README.md                  # 프레임워크 비교 요약
│   │   ├── erlang-otp.md              # Erlang/OTP
│   │   ├── akka.md                    # Akka (JVM)
│   │   ├── akka-net.md                # Akka.NET
│   │   ├── orleans.md                 # Microsoft Orleans (Virtual Actor)
│   │   ├── proto-actor.md             # Proto.Actor
│   │   └── comparison-table.md        # 종합 비교표
│   │
│   ├── 06-game-server/
│   │   ├── README.md                  # 게임 서버 적용 개요
│   │   ├── use-cases.md               # 적용 사례 (Halo, EVE Online 등)
│   │   ├── architecture-patterns.md   # 아키텍처 패턴
│   │   ├── game-room-actor.md         # 게임룸 액터 설계
│   │   ├── player-actor.md            # 플레이어 액터 설계
│   │   └── state-persistence.md       # 상태 영속화
│   │
│   ├── 07-realtime-game/
│   │   ├── README.md                  # 실시간 게임 적합성 분석
│   │   ├── latency-considerations.md  # 레이턴시 고려사항
│   │   ├── tick-based-vs-event.md     # Tick 기반 vs 이벤트 기반
│   │   ├── physics-simulation.md      # 물리 시뮬레이션
│   │   ├── mmo-architecture.md        # MMO 아키텍처
│   │   └── fps-rts-patterns.md        # FPS/RTS 패턴
│   │
│   ├── 08-web-server/
│   │   ├── README.md                  # 웹 서버 적합성 분석
│   │   ├── request-response.md        # 요청-응답 패턴
│   │   ├── session-management.md      # 세션 관리
│   │   ├── stateful-vs-stateless.md   # Stateful vs Stateless
│   │   └── scaling-patterns.md        # 스케일링 패턴
│   │
│   └── 09-open-source/
│       ├── README.md                  # 분석할 오픈소스 목록
│       ├── caf.md                     # C++ Actor Framework 분석
│       ├── orleans-repo.md            # Orleans 저장소 분석
│       ├── akka-repo.md               # Akka 저장소 분석
│       ├── proto-actor-repo.md        # Proto.Actor 분석
│       └── game-frameworks.md         # 게임 관련 프레임워크
│
└── examples/
    ├── 01-basic-actor/                # 기본 액터 예제
    │   ├── typescript/
    │   ├── csharp/
    │   └── go/
    │
    ├── 02-message-passing/            # 메시지 패싱 예제
    │   ├── typescript/
    │   ├── csharp/
    │   └── go/
    │
    ├── 03-supervision/                # 감독 트리 예제
    │   ├── typescript/
    │   ├── csharp/
    │   └── go/
    │
    ├── 04-game-room/                  # 게임룸 구현 예제
    │   ├── typescript/
    │   ├── csharp/
    │   └── go/
    │
    └── 05-chat-server/                # 채팅 서버 예제
        ├── typescript/
        ├── csharp/
        └── go/
```

---

## 📚 섹션별 상세 계획

### 1. Introduction (소개)

**목표**: Actor Model이 무엇인지 빠르게 이해

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 1분 안에 이해하는 Actor Model | ⭐ |
| history.md | 1973년 Carl Hewitt의 논문부터 현재까지 | ⭐⭐⭐ |
| why-actor-model.md | 동시성 문제 해결을 위한 Actor Model의 필요성 | ⭐⭐ |

**핵심 키워드**: Carl Hewitt, 1973, 메시지 패싱, 동시성

---

### 2. Core Concepts (핵심 개념)

**목표**: Actor의 3가지 핵심 요소 완벽 이해

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | Actor = State + Behavior + Mailbox | ⭐ |
| actor.md | Actor의 정의, 특성, 생명주기 | ⭐⭐⭐ |
| message-passing.md | 비동기 메시지 패싱의 원리 | ⭐⭐⭐ |
| mailbox.md | Mailbox 자료구조와 메시지 처리 순서 | ⭐⭐⭐ |
| state-behavior.md | 상태 변경과 행위 전환 (become/unbecome) | ⭐⭐ |
| location-transparency.md | 분산 환경에서의 위치 투명성 | ⭐⭐⭐ |

**핵심 키워드**: Encapsulation, Mailbox, FIFO, Asynchronous

---

### 3. Actor vs Threads (스레드와 비교)

**목표**: 왜 스레드 대신 Actor를 사용하는지 이해

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 한눈에 보는 비교표 | ⭐ |
| thread-problems.md | Race Condition, Deadlock, 공유 메모리 문제 | ⭐⭐⭐ |
| lock-free.md | Lock-Free 동시성의 원리 | ⭐⭐⭐ |
| performance-comparison.md | 메모리 사용량, 컨텍스트 스위칭, 처리량 비교 | ⭐⭐⭐ |
| when-to-use.md | Actor Model이 적합한/부적합한 상황 | ⭐⭐ |

**핵심 키워드**: Lock-Free, Race Condition, Deadlock, Context Switching

---

### 4. Supervision (감독 시스템)

**목표**: 장애 허용 시스템 설계 방법 이해

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | Supervision이란? | ⭐ |
| supervision-tree.md | 계층적 감독 트리 구조 | ⭐⭐⭐ |
| let-it-crash.md | Erlang의 "Let it Crash" 철학 | ⭐⭐⭐ |
| restart-strategies.md | one-for-one, one-for-all, rest-for-one | ⭐⭐⭐ |
| fault-tolerance.md | 장애 격리, 복구, 에스컬레이션 | ⭐⭐⭐ |

**핵심 키워드**: Supervisor, Worker, Restart Strategy, Fault Isolation

---

### 5. Frameworks (주요 프레임워크)

**목표**: 언어별 주요 프레임워크 이해 및 선택 가이드

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 프레임워크 선택 가이드 | ⭐ |
| erlang-otp.md | Erlang/OTP - Actor Model의 원조 | ⭐⭐⭐ |
| akka.md | Akka - JVM 생태계 최강자 | ⭐⭐⭐ |
| akka-net.md | Akka.NET - .NET 포팅 | ⭐⭐ |
| orleans.md | Orleans - Virtual Actor 패턴 | ⭐⭐⭐ |
| proto-actor.md | Proto.Actor - 크로스 플랫폼 | ⭐⭐ |
| comparison-table.md | 성능, 기능, 학습곡선 종합 비교 | ⭐⭐⭐ |

**핵심 키워드**: Erlang, Akka, Orleans, Virtual Actor, gRPC

---

### 6. Game Server (게임 서버 적용)

**목표**: 게임 서버에서 Actor Model 활용법 이해

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 게임 서버와 Actor Model | ⭐ |
| use-cases.md | Halo, EVE Online 등 실제 사례 분석 | ⭐⭐⭐ |
| architecture-patterns.md | 게임 서버 아키텍처 패턴 | ⭐⭐⭐ |
| game-room-actor.md | 게임룸 설계 (매칭, 상태 관리) | ⭐⭐⭐ |
| player-actor.md | 플레이어 세션 관리 | ⭐⭐ |
| state-persistence.md | 게임 상태 저장/복원 | ⭐⭐⭐ |

**핵심 키워드**: Game Room, Player Session, State Sync, Persistence

---

### 7. Real-time Game (실시간 게임)

**목표**: 실시간 게임에서의 적합성 깊이 분석

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 실시간 게임에 Actor Model이 적합한가? | ⭐ |
| latency-considerations.md | 메시지 지연, 네트워크 지연 고려 | ⭐⭐⭐ |
| tick-based-vs-event.md | Tick 기반 vs 이벤트 기반 설계 | ⭐⭐⭐ |
| physics-simulation.md | 물리 시뮬레이션과 Actor 분리 | ⭐⭐⭐ |
| mmo-architecture.md | MMO의 Zone/Shard 설계 | ⭐⭐⭐ |
| fps-rts-patterns.md | FPS, RTS 장르별 패턴 | ⭐⭐ |

**핵심 키워드**: Latency, Tick Rate, Zone, Time Dilation

---

### 8. Web Server (웹 서버 / 비실시간)

**목표**: 웹 서비스에서의 Actor Model 적용 가능성 분석

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 웹 서버에 Actor Model이 필요한가? | ⭐ |
| request-response.md | Request-Response와 Actor 매핑 | ⭐⭐ |
| session-management.md | 사용자 세션 관리 패턴 | ⭐⭐⭐ |
| stateful-vs-stateless.md | Stateful 서비스의 장단점 | ⭐⭐⭐ |
| scaling-patterns.md | 수평 확장 전략 | ⭐⭐ |

**핵심 키워드**: Stateful, Session, Scaling, HTTP

---

### 9. Open Source (오픈소스 분석)

**목표**: 실제 코드베이스 분석을 통한 심화 학습

| 문서 | 내용 | 깊이 |
|------|------|------|
| README.md | 분석 추천 레포지토리 목록 | ⭐ |
| caf.md | C++ Actor Framework 구조 분석 | ⭐⭐⭐ |
| orleans-repo.md | Orleans 내부 구조 분석 | ⭐⭐⭐ |
| akka-repo.md | Akka 소스코드 분석 | ⭐⭐⭐ |
| proto-actor-repo.md | Proto.Actor 설계 분석 | ⭐⭐ |
| game-frameworks.md | NFrame 등 게임용 프레임워크 | ⭐⭐⭐ |

---

## 💻 예제 코드 계획

### 사용 언어
- **TypeScript**: 가장 접근성 좋은 언어로 기본 예제 제공
- **C#**: Orleans/Akka.NET 활용 예제
- **Go**: Proto.Actor 활용 예제

### 예제 목록

| 예제 | 설명 | 난이도 |
|------|------|--------|
| 01-basic-actor | 간단한 Counter Actor 구현 | 초급 |
| 02-message-passing | Ask/Tell 패턴, 메시지 라우팅 | 초급 |
| 03-supervision | 감독 트리와 장애 복구 | 중급 |
| 04-game-room | 멀티플레이어 게임룸 구현 | 중급 |
| 05-chat-server | 채팅 서버 구현 | 중급 |

---

## 📖 참고 자료 (조사 결과)

### 공식 문서 및 논문
- [Actor Model - Wikipedia](https://en.wikipedia.org/wiki/Actor_model)
- [Akka Documentation](https://doc.akka.io/libraries/akka-core/current/typed/guide/actors-intro.html)
- [Orleans Documentation](https://learn.microsoft.com/en-us/dotnet/orleans/overview)
- [Erlang OTP Design Principles](https://www.erlang.org/doc/system/design_principles.html)

### 튜토리얼 및 가이드
- [The Actor Model in 10 minutes](https://www.brianstorti.com/the-actor-model/)
- [GeeksforGeeks - Actor Model in Distributed Systems](https://www.geeksforgeeks.org/system-design/actor-model-in-distributed-systems/)
- [Akka.NET - What problems does actor model solve?](https://getakka.net/articles/intro/what-problems-does-actor-model-solve.html)

### 게임 개발 관련
- [The Actor Model in Game Development](https://vhlam.com/article/the-actor-model-in-game-development)
- [Creating scalable backends for games using Orleans](https://www.gamedeveloper.com/programming/creating-scalable-backends-for-games-using-open-source-orleans-framework)
- [GameDev.net - Distributed actor model for realtime game server](https://www.gamedev.net/forums/topic/672410-distrubuted-actor-model-for-a-realtime-game-server/)

### 오픈소스 프로젝트
- [C++ Actor Framework (CAF)](https://github.com/actor-framework/actor-framework)
- [Microsoft Orleans](https://github.com/dotnet/orleans)
- [Proto.Actor](https://github.com/asynkron/protoactor-go)
- [NFrame - Game Server Framework](https://github.com/ketoo/NFrame)
- [Awesome Actor List](https://github.com/GetTech-io/awesome-actor)

### 비교 분석
- [Akka vs Orleans Comparison](https://github.com/akka/akka-meta/blob/master/ComparisonWithOrleans.md)
- [Etteplan - Comparing .NET virtual actor frameworks](https://www.etteplan.com/about-us/insights/comparing-net-virtual-actor-frameworks/)
- [Medium - Actors and Virtual Actors Comparison](https://nittikkin.medium.com/actors-and-virtual-actors-a-comparison-across-akka-dapr-orleans-and-service-fabric-c6c67c618f27)

---

## ⏱️ 작업 순서

### Phase 1: 기초 문서 작성
1. ✅ 계획서 작성 (PLAN.md)
2. ⬜ README.md 메인 페이지 작성
3. ⬜ 01-introduction 섹션 작성
4. ⬜ 02-core-concepts 섹션 작성

### Phase 2: 비교 및 심화 문서
5. ⬜ 03-actor-vs-threads 섹션 작성
6. ⬜ 04-supervision 섹션 작성
7. ⬜ 05-frameworks 섹션 작성

### Phase 3: 게임 서버 특화 문서
8. ⬜ 06-game-server 섹션 작성
9. ⬜ 07-realtime-game 섹션 작성
10. ⬜ 08-web-server 섹션 작성

### Phase 4: 심화 학습 자료
11. ⬜ 09-open-source 섹션 작성
12. ⬜ 예제 코드 작성

---

## 🎯 완료 기준

- [ ] 모든 섹션의 README.md가 간결한 요약 제공
- [ ] 각 심화 문서가 충분한 깊이의 설명 제공
- [ ] 모든 예제 코드가 실행 가능
- [ ] 게임 서버 관련 섹션이 실무에 적용 가능한 수준
- [ ] 참고할 오픈소스 목록과 분석 가이드 제공

---

*이 계획서는 프로젝트 진행에 따라 업데이트됩니다.*
