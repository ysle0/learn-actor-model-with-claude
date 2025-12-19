# 09. Open Source - 분석할 오픈소스 레포지토리

> Actor Model을 학습하기 위해 분석할 만한 오픈소스 프로젝트들을 소개합니다.

## 추천 레포지토리 목록

```
┌─────────────────────────────────────────────────────────────────┐
│                    분석 추천 프로젝트                           │
├──────────────────────┬──────────┬───────────────────────────────┤
│       프로젝트        │   언어   │           특징               │
├──────────────────────┼──────────┼───────────────────────────────┤
│ dotnet/orleans       │   C#     │ Virtual Actor의 정석         │
│ akka/akka            │  Scala   │ 가장 성숙한 Actor 프레임워크  │
│ actor-framework/caf  │   C++    │ 고성능 C++ 구현              │
│ asynkron/protoactor  │  Go/C#   │ 크로스 플랫폼 gRPC 기반      │
│ etorth/mir2x         │   C++    │ Actor 기반 MMORPG            │
│ ketoo/NoahGameFrame  │   C++    │ 게임 서버 프레임워크         │
└──────────────────────┴──────────┴───────────────────────────────┘
```

---

## 프레임워크

### 1. Microsoft Orleans

```
📦 dotnet/orleans
🌐 https://github.com/dotnet/orleans
⭐ 10k+ stars
📝 C#

학습 포인트:
─────────────
• Virtual Actor (Grain) 구현
• 자동 활성화/비활성화 메커니즘
• 분산 상태 관리
• Silo 클러스터링
• Persistence Provider 패턴

분석 시작점:
────────────
├── src/Orleans.Core/        → 핵심 개념
├── src/Orleans.Runtime/     → 런타임 구현
├── samples/                 → 예제 프로젝트
└── test/                    → 테스트 케이스
```

**핵심 파일:**
- `src/Orleans.Core/Core/Grain.cs` - Grain 기본 클래스
- `src/Orleans.Runtime/Catalog/ActivationData.cs` - 활성화 관리
- `src/Orleans.Runtime/Messaging/` - 메시지 시스템

### 2. Akka

```
📦 akka/akka
🌐 https://github.com/akka/akka
⭐ 13k+ stars
📝 Scala

학습 포인트:
─────────────
• Classic Actor vs Typed Actor
• Actor 생명주기
• Supervision 전략
• 클러스터 샤딩
• Persistence (Event Sourcing)
• Streams

분석 시작점:
────────────
├── akka-actor/             → 기본 Actor 구현
├── akka-actor-typed/       → 타입 안전 Actor
├── akka-cluster/           → 클러스터링
├── akka-persistence/       → 이벤트 소싱
└── akka-stream/            → 스트림 처리
```

### 3. C++ Actor Framework (CAF)

```
📦 actor-framework/actor-framework
🌐 https://github.com/actor-framework/actor-framework
⭐ 3k+ stars
📝 C++

학습 포인트:
─────────────
• C++에서의 Actor 구현
• 타입 안전 메시지 패싱
• 패턴 매칭
• 네트워크 투명성
• I/O Actor

분석 시작점:
────────────
├── libcaf_core/            → 핵심 Actor 시스템
│   ├── caf/actor.hpp       → Actor 인터페이스
│   ├── caf/behavior.hpp    → 행위 정의
│   └── caf/mailbox.hpp     → Mailbox 구현
├── libcaf_io/              → 네트워크 I/O
└── examples/               → 예제
```

**핵심 구현 분석:**
```cpp
// behavior 패턴 매칭 살펴보기
behavior my_actor(event_based_actor* self) {
  return {
    [=](int x) { /* 정수 메시지 처리 */ },
    [=](const std::string& s) { /* 문자열 처리 */ }
  };
}
```

### 4. Proto.Actor

```
📦 asynkron/protoactor-go
📦 asynkron/protoactor-dotnet
🌐 https://github.com/asynkron/protoactor-go
⭐ 5k+ stars
📝 Go, C#

학습 포인트:
─────────────
• 크로스 플랫폼 Actor 통신
• gRPC 기반 원격 호출
• Virtual Actor 지원
• 클러스터 grain
• 가벼운 설계

분석 시작점 (Go):
────────────────
├── actor/              → Actor 핵심
│   ├── actor.go        → Actor 인터페이스
│   ├── context.go      → 컨텍스트
│   └── mailbox.go      → Mailbox
├── cluster/            → 클러스터링
└── remote/             → 원격 통신
```

---

## 게임 서버

### 5. mir2x (MMORPG)

```
📦 etorth/mir2x
🌐 https://github.com/etorth/mir2x
⭐ 1k+ stars
📝 C++20

특징:
──────
• C++20 코루틴으로 Actor 모델 구현
• MMORPG 전체 구현 (클라이언트 + 서버)
• 병렬 처리 검증 프로젝트

학습 포인트:
─────────────
• 게임 서버에서 Actor 활용
• 코루틴 기반 비동기 처리
• 게임 로직과 Actor 통합

분석 시작점:
────────────
├── server/             → 서버 구현
│   ├── src/            → 핵심 로직
│   └── script/         → 스크립트
├── common/             → 공통 코드
└── client/             → 클라이언트
```

### 6. NoahGameFrame (NFrame)

```
📦 ketoo/NoahGameFrame
🌐 https://github.com/ketoo/NoahGameFrame
⭐ 4k+ stars
📝 C++

특징:
──────
• Actor 라이브러리 내장
• MMO RPG/MOBA 지원
• Unity3D, Cocos2dx 연동
• Lua/C# 스크립트 지원

학습 포인트:
─────────────
• 게임 서버 아키텍처 설계
• 이벤트/속성 기반 설계
• 플러그인 시스템
• 게임 프레임워크 구조

분석 시작점:
────────────
├── NFComm/             → 공통 라이브러리
│   ├── NFActorPlugin/  → Actor 플러그인
│   └── NFCore/         → 핵심 기능
├── NFServer/           → 서버 구현
└── _Out/               → 빌드 결과
```

---

## 분석 가이드

### 어디서부터 시작할까?

```
입문자 (Actor Model 처음):
────────────────────────
1. Orleans samples/ 폴더의 HelloWorld
2. Proto.Actor의 examples/
3. CAF의 examples/

중급자 (프레임워크 구조 이해):
──────────────────────────
1. Orleans의 Grain 생명주기
2. Akka의 Supervision 구현
3. CAF의 Mailbox 구현

고급자 (게임 서버 적용):
──────────────────────
1. mir2x 전체 아키텍처
2. NoahGameFrame의 Actor 통합
3. 직접 게임 서버 프로토타입
```

### 코드 리딩 팁

```
1. 테스트 코드부터 읽기
   ─────────────────────
   • 사용법을 먼저 이해
   • 의도한 동작 파악

2. 인터페이스/추상화 먼저
   ───────────────────────
   • 핵심 개념 정의 확인
   • 구현 세부사항은 나중에

3. 메시지 흐름 추적
   ─────────────────
   • send() → mailbox → receive()
   • 디버거로 따라가기

4. 문서 + 코드 병행
   ─────────────────
   • 공식 문서로 개념 이해
   • 코드로 실제 구현 확인
```

---

## 심화 문서

| 프로젝트 | 분석 문서 |
|----------|-----------|
| CAF | [caf.md](./caf.md) |
| Orleans | [orleans-repo.md](./orleans-repo.md) |
| Akka | [akka-repo.md](./akka-repo.md) |
| Proto.Actor | [proto-actor-repo.md](./proto-actor-repo.md) |
| 게임 프레임워크 | [game-frameworks.md](./game-frameworks.md) |

---

## 추가 리소스

### Awesome Lists

```
📦 GetTech-io/awesome-actor
🌐 https://github.com/GetTech-io/awesome-actor

Actor Model 관련 리소스 모음:
• 프레임워크
• 튜토리얼
• 논문
• 영상
```

### 학습 순서 제안

```
1주차: 개념 이해
├── 이 레포의 01-05 섹션 학습
└── The Actor Model in 10 minutes 읽기

2주차: 프레임워크 실습
├── 선택한 프레임워크 튜토리얼
└── 간단한 채팅 서버 구현

3주차: 오픈소스 분석
├── Orleans 또는 Akka 코드 리딩
└── 핵심 구조 이해

4주차: 프로젝트 적용
├── 게임 서버 프로토타입
└── 또는 실시간 서비스 구현
```

---

## 다음 단계

- [Examples](../../examples/) - 예제 코드 실습
- [README](../../README.md) - 메인 페이지로 돌아가기
