// Message Passing Patterns - Tell, Ask, Forward in Go
// Proto.Actor 스타일로 구현

package main

import (
	"fmt"
	"sync"
	"time"
)

// ============================================
// Actor System 기본 인프라
// ============================================

type PID struct {
	name  string
	actor Actor
}

func (p *PID) Tell(msg interface{}) {
	p.actor.receive(msg, nil)
}

func (p *PID) Ask(msg interface{}) interface{} {
	result := make(chan interface{}, 1)
	p.actor.receive(msg, result)
	return <-result
}

type Actor interface {
	receive(msg interface{}, reply chan interface{})
}

type ActorSystem struct {
	actors map[string]*PID
	mu     sync.RWMutex
}

func NewActorSystem() *ActorSystem {
	return &ActorSystem{
		actors: make(map[string]*PID),
	}
}

func (s *ActorSystem) Spawn(name string, actor Actor) *PID {
	s.mu.Lock()
	defer s.mu.Unlock()

	pid := &PID{name: name, actor: actor}
	s.actors[name] = pid

	if a, ok := actor.(interface{ SetSystem(*ActorSystem) }); ok {
		a.SetSystem(s)
	}

	return pid
}

func (s *ActorSystem) Get(name string) *PID {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.actors[name]
}

// ============================================
// 메시지 타입 정의
// ============================================

// Order 메시지
type CreateOrder struct {
	OrderID string
	Amount  float64
}

type OrderCreated struct {
	OrderID string
	Status  string
}

type PaymentResult struct {
	OrderID string
	Success bool
}

// Payment 메시지
type ValidatePayment struct {
	OrderID string
	Amount  float64
	ReplyTo *PID
}

type ProcessPayment struct {
	OrderID string
	Amount  float64
}

type PaymentResponse struct {
	Success       bool
	TransactionID string
}

// Shipping 메시지
type ShipOrder struct {
	OrderID string
	Address string
}

type ShippingStatus struct {
	OrderID string
}

// Notification 메시지
type Notify struct {
	Message string
}

type Broadcast struct {
	Message string
	Targets []*PID
}

// ============================================
// Actor 구현
// ============================================

// OrderActor
type OrderActor struct {
	system *ActorSystem
	orders map[string]struct {
		Status string
		Amount float64
	}
	mu sync.Mutex
}

func NewOrderActor() *OrderActor {
	return &OrderActor{
		orders: make(map[string]struct {
			Status string
			Amount float64
		}),
	}
}

func (a *OrderActor) SetSystem(s *ActorSystem) {
	a.system = s
}

func (a *OrderActor) receive(msg interface{}, reply chan interface{}) {
	a.mu.Lock()
	defer a.mu.Unlock()

	switch m := msg.(type) {
	case CreateOrder:
		fmt.Printf("[OrderActor] Creating order: %s\n", m.OrderID)
		a.orders[m.OrderID] = struct {
			Status string
			Amount float64
		}{Status: "pending", Amount: m.Amount}

		// Tell 패턴: PaymentActor에게 검증 요청
		payment := a.system.Get("payment")
		if payment != nil {
			go payment.Tell(ValidatePayment{
				OrderID: m.OrderID,
				Amount:  m.Amount,
				ReplyTo: a.system.Get("order"),
			})
		}

		if reply != nil {
			reply <- OrderCreated{OrderID: m.OrderID, Status: "processing"}
		}

	case PaymentResult:
		fmt.Printf("[OrderActor] Payment result for %s: %v\n", m.OrderID, m.Success)
		if order, exists := a.orders[m.OrderID]; exists {
			if m.Success {
				order.Status = "paid"
				a.orders[m.OrderID] = order

				// Forward 패턴: ShippingActor에게 전달
				shipping := a.system.Get("shipping")
				if shipping != nil {
					go shipping.Tell(ShipOrder{
						OrderID: m.OrderID,
						Address: "123 Main St",
					})
				}
			} else {
				order.Status = "payment_failed"
				a.orders[m.OrderID] = order
			}
		}
	}
}

// PaymentActor
type PaymentActor struct {
	system *ActorSystem
}

func NewPaymentActor() *PaymentActor {
	return &PaymentActor{}
}

func (a *PaymentActor) SetSystem(s *ActorSystem) {
	a.system = s
}

func (a *PaymentActor) receive(msg interface{}, reply chan interface{}) {
	switch m := msg.(type) {
	case ValidatePayment:
		fmt.Printf("[PaymentActor] Validating payment for order: %s\n", m.OrderID)

		// 결제 처리 시뮬레이션
		time.Sleep(100 * time.Millisecond)

		success := time.Now().UnixNano()%10 > 2 // 약 80% 성공률
		status := "rejected"
		if success {
			status = "approved"
		}
		fmt.Printf("[PaymentActor] Payment %s\n", status)

		// Tell 패턴: 결과를 OrderActor에게 알림
		if m.ReplyTo != nil {
			go m.ReplyTo.Tell(PaymentResult{
				OrderID: m.OrderID,
				Success: success,
			})
		}

	case ProcessPayment:
		fmt.Printf("[PaymentActor] Processing payment: $%.2f\n", m.Amount)
		time.Sleep(100 * time.Millisecond)

		if reply != nil {
			reply <- PaymentResponse{
				Success:       true,
				TransactionID: fmt.Sprintf("TXN-%d", time.Now().UnixNano()),
			}
		}
	}
}

// ShippingActor
type ShippingActor struct {
	shipments map[string]struct {
		Status  string
		Address string
	}
	mu sync.Mutex
}

func NewShippingActor() *ShippingActor {
	return &ShippingActor{
		shipments: make(map[string]struct {
			Status  string
			Address string
		}),
	}
}

func (a *ShippingActor) receive(msg interface{}, reply chan interface{}) {
	a.mu.Lock()
	defer a.mu.Unlock()

	switch m := msg.(type) {
	case ShipOrder:
		fmt.Printf("[ShippingActor] Shipping order %s to %s\n", m.OrderID, m.Address)
		a.shipments[m.OrderID] = struct {
			Status  string
			Address string
		}{Status: "shipped", Address: m.Address}

		if reply != nil {
			reply <- map[string]bool{"shipped": true}
		}

	case ShippingStatus:
		if shipment, exists := a.shipments[m.OrderID]; exists {
			if reply != nil {
				reply <- shipment
			}
		} else if reply != nil {
			reply <- map[string]string{"status": "not_found"}
		}
	}
}

// NotificationActor
type NotificationActor struct {
	name string
}

func NewNotificationActor(name string) *NotificationActor {
	return &NotificationActor{name: name}
}

func (a *NotificationActor) receive(msg interface{}, reply chan interface{}) {
	switch m := msg.(type) {
	case Notify:
		fmt.Printf("[%s] Received notification: %s\n", a.name, m.Message)
	}
}

// BroadcasterActor
type BroadcasterActor struct{}

func NewBroadcasterActor() *BroadcasterActor {
	return &BroadcasterActor{}
}

func (a *BroadcasterActor) receive(msg interface{}, reply chan interface{}) {
	switch m := msg.(type) {
	case Broadcast:
		fmt.Printf("[Broadcaster] Broadcasting to %d actors\n", len(m.Targets))

		// Broadcast: 모든 타겟에게 Tell
		for _, target := range m.Targets {
			go target.Tell(Notify{Message: m.Message})
		}
	}
}

// ============================================
// 메인 함수
// ============================================

func main() {
	fmt.Println("=== Message Passing Patterns Demo (Go) ===\n")

	system := NewActorSystem()

	// Actor 생성
	orderActor := system.Spawn("order", NewOrderActor())
	system.Spawn("payment", NewPaymentActor())
	system.Spawn("shipping", NewShippingActor())

	fmt.Println("--- 1. Tell Pattern (Fire-and-Forget) ---\n")

	// Tell: 응답 없이 메시지 전송
	orderActor.Tell(CreateOrder{
		OrderID: "ORD-001",
		Amount:  99.99,
	})

	time.Sleep(500 * time.Millisecond)

	fmt.Println("\n--- 2. Ask Pattern (Request-Response) ---\n")

	// Ask: 응답 대기
	paymentActor := system.Get("payment")
	result := paymentActor.Ask(ProcessPayment{
		OrderID: "ORD-002",
		Amount:  150.0,
	})

	if resp, ok := result.(PaymentResponse); ok {
		fmt.Printf("Payment result: Success=%v, TxnID=%s\n", resp.Success, resp.TransactionID)
	}

	fmt.Println("\n--- 3. Broadcast Pattern ---\n")

	// Broadcast 설정
	notifier1 := system.Spawn("notifier1", NewNotificationActor("Notifier-1"))
	notifier2 := system.Spawn("notifier2", NewNotificationActor("Notifier-2"))
	notifier3 := system.Spawn("notifier3", NewNotificationActor("Notifier-3"))
	broadcaster := system.Spawn("broadcaster", NewBroadcasterActor())

	broadcaster.Tell(Broadcast{
		Message: "System maintenance in 5 minutes",
		Targets: []*PID{notifier1, notifier2, notifier3},
	})

	time.Sleep(200 * time.Millisecond)

	fmt.Println("\n=== Demo Complete ===")
}
