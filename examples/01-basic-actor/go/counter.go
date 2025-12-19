/**
 * Basic Actor Pattern - Counter Actor in Go with Proto.Actor
 *
 * 의존성 설치:
 * go get github.com/asynkron/protoactor-go
 */

package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/asynkron/protoactor-go/actor"
)

// ============================================
// Message Types (메시지 타입 정의)
// ============================================

// Tell 메시지 (응답 없음)
type Increment struct{}
type Decrement struct{}
type Reset struct{}

// Ask 메시지 (응답 필요)
type GetCount struct{}
type CountResponse struct {
	Count int
}

// ============================================
// Counter Actor
// ============================================

type CounterActor struct {
	count int
}

func (c *CounterActor) Receive(ctx actor.Context) {
	switch msg := ctx.Message().(type) {
	case *actor.Started:
		fmt.Println("Counter Actor started")

	case *actor.Stopped:
		fmt.Println("Counter Actor stopped")

	case *Increment:
		c.count++
		fmt.Printf("Incremented: %d\n", c.count)

	case *Decrement:
		c.count--
		fmt.Printf("Decremented: %d\n", c.count)

	case *GetCount:
		ctx.Respond(&CountResponse{Count: c.count})

	case *Reset:
		c.count = 0
		fmt.Println("Reset to 0")

	default:
		fmt.Printf("Unknown message: %T\n", msg)
	}
}

// ============================================
// Main
// ============================================

func main() {
	fmt.Println("=== Counter Actor Example (Go) ===")
	fmt.Println()

	// Actor System 생성
	system := actor.NewActorSystem()

	// Counter Actor 생성
	props := actor.PropsFromProducer(func() actor.Actor {
		return &CounterActor{}
	})

	pid := system.Root.Spawn(props)

	// Tell 패턴: 응답 없이 메시지 전송
	system.Root.Send(pid, &Increment{})
	system.Root.Send(pid, &Increment{})
	system.Root.Send(pid, &Increment{})
	system.Root.Send(pid, &Decrement{})

	// 처리 대기
	time.Sleep(100 * time.Millisecond)

	// Ask 패턴: 응답 대기
	future := system.Root.RequestFuture(pid, &GetCount{}, 5*time.Second)
	result, err := future.Result()
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}

	response := result.(*CountResponse)
	fmt.Printf("\nFinal count: %d\n", response.Count)

	// Reset
	system.Root.Send(pid, &Reset{})
	time.Sleep(100 * time.Millisecond)

	future = system.Root.RequestFuture(pid, &GetCount{}, 5*time.Second)
	result, _ = future.Result()
	fmt.Printf("After reset: %d\n", result.(*CountResponse).Count)

	// Actor 종료
	system.Root.Stop(pid)
	time.Sleep(100 * time.Millisecond)

	// 동시성 테스트
	concurrencyDemo(system)
}

// ============================================
// Concurrency Demo
// ============================================

func concurrencyDemo(system *actor.ActorSystem) {
	fmt.Println("\n=== Concurrency Demo ===")
	fmt.Println()

	props := actor.PropsFromProducer(func() actor.Actor {
		return &CounterActor{}
	})

	pid := system.Root.Spawn(props)

	// 1000개의 동시 요청
	var wg sync.WaitGroup
	wg.Add(1000)

	for i := 0; i < 1000; i++ {
		go func() {
			defer wg.Done()
			system.Root.Send(pid, &Increment{})
		}()
	}

	wg.Wait()
	time.Sleep(500 * time.Millisecond)

	// 결과 확인
	future := system.Root.RequestFuture(pid, &GetCount{}, 5*time.Second)
	result, _ := future.Result()
	count := result.(*CountResponse).Count

	fmt.Printf("Expected: 1000, Actual: %d\n", count)
	if count == 1000 {
		fmt.Println("Thread-safe: ✅ YES")
	} else {
		fmt.Println("Thread-safe: ❌ NO")
	}

	system.Root.Stop(pid)
}

// ============================================
// 간단한 구현 (Proto.Actor 없이)
// ============================================

// 프레임워크 없이 개념 이해를 위한 구현

type SimpleMessage interface{}

type SimpleActor struct {
	mailbox chan SimpleMessage
	count   int
	done    chan struct{}
}

func NewSimpleActor() *SimpleActor {
	a := &SimpleActor{
		mailbox: make(chan SimpleMessage, 100),
		done:    make(chan struct{}),
	}
	go a.run()
	return a
}

func (a *SimpleActor) run() {
	for {
		select {
		case msg := <-a.mailbox:
			switch msg.(type) {
			case *Increment:
				a.count++
			case *Decrement:
				a.count--
			case *Reset:
				a.count = 0
			}
		case <-a.done:
			return
		}
	}
}

func (a *SimpleActor) Send(msg SimpleMessage) {
	a.mailbox <- msg
}

func (a *SimpleActor) Stop() {
	close(a.done)
}
