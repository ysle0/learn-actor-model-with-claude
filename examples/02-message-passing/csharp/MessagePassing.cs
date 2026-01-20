// Message Passing Patterns - Tell, Ask, Forward in C#
// Orleans 스타일로 구현

using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace MessagePassingExample
{
    // ============================================
    // 메시지 타입 정의
    // ============================================

    public record CreateOrder(string OrderId, decimal Amount);
    public record OrderCreated(string OrderId, string Status);
    public record PaymentResult(string OrderId, bool Success);
    public record ValidatePayment(string OrderId, decimal Amount);
    public record ProcessPayment(string OrderId, decimal Amount);
    public record PaymentResponse(bool Success, string TransactionId);
    public record ShipOrder(string OrderId, string Address);
    public record Notify(string Message);

    // ============================================
    // Grain 인터페이스 (Orleans 스타일)
    // ============================================

    public interface IOrderGrain
    {
        Task<OrderCreated> CreateOrder(CreateOrder request);
        Task HandlePaymentResult(PaymentResult result);
    }

    public interface IPaymentGrain
    {
        Task ValidatePayment(ValidatePayment request);
        Task<PaymentResponse> ProcessPayment(ProcessPayment request);
    }

    public interface IShippingGrain
    {
        Task ShipOrder(ShipOrder request);
        Task<string> GetStatus(string orderId);
    }

    public interface INotificationGrain
    {
        Task Notify(Notify notification);
    }

    // ============================================
    // 간단한 Grain Factory (Orleans 시뮬레이션)
    // ============================================

    public static class GrainFactory
    {
        private static readonly Dictionary<Type, object> _grains = new();

        public static T GetGrain<T>(string id) where T : class, new()
        {
            var key = typeof(T);
            if (!_grains.ContainsKey(key))
            {
                _grains[key] = new T();
            }
            return (T)_grains[key];
        }

        public static void RegisterGrain<T>(T grain) where T : class
        {
            _grains[typeof(T)] = grain;
        }
    }

    // ============================================
    // Grain 구현
    // ============================================

    // OrderGrain: 주문 처리 조율
    public class OrderGrain : IOrderGrain
    {
        private readonly Dictionary<string, (string Status, decimal Amount)> _orders = new();

        // Ask 패턴: 응답 반환
        public async Task<OrderCreated> CreateOrder(CreateOrder request)
        {
            Console.WriteLine($"[OrderGrain] Creating order: {request.OrderId}");
            _orders[request.OrderId] = ("pending", request.Amount);

            // Tell 패턴: PaymentGrain에게 검증 요청 (응답 안 기다림)
            var paymentGrain = GrainFactory.GetGrain<PaymentGrain>("payment");
            _ = paymentGrain.ValidatePayment(new ValidatePayment(request.OrderId, request.Amount));

            return new OrderCreated(request.OrderId, "processing");
        }

        // Tell 패턴으로 받은 결과 처리
        public async Task HandlePaymentResult(PaymentResult result)
        {
            Console.WriteLine($"[OrderGrain] Payment result for {result.OrderId}: {result.Success}");

            if (_orders.TryGetValue(result.OrderId, out var order))
            {
                if (result.Success)
                {
                    _orders[result.OrderId] = ("paid", order.Amount);

                    // Forward 패턴: ShippingGrain에게 전달
                    var shippingGrain = GrainFactory.GetGrain<ShippingGrain>("shipping");
                    await shippingGrain.ShipOrder(new ShipOrder(result.OrderId, "123 Main St"));
                }
                else
                {
                    _orders[result.OrderId] = ("payment_failed", order.Amount);
                }
            }
        }
    }

    // PaymentGrain: 결제 처리
    public class PaymentGrain : IPaymentGrain
    {
        // Tell 패턴: 응답 없이 처리 후 결과를 OrderGrain에 알림
        public async Task ValidatePayment(ValidatePayment request)
        {
            Console.WriteLine($"[PaymentGrain] Validating payment for order: {request.OrderId}");

            // 결제 처리 시뮬레이션
            await Task.Delay(100);

            var success = new Random().NextDouble() > 0.2; // 80% 성공률
            Console.WriteLine($"[PaymentGrain] Payment {(success ? "approved" : "rejected")}");

            // Tell 패턴: 결과를 OrderGrain에게 알림
            var orderGrain = GrainFactory.GetGrain<OrderGrain>("order");
            await orderGrain.HandlePaymentResult(new PaymentResult(request.OrderId, success));
        }

        // Ask 패턴: 응답 반환
        public async Task<PaymentResponse> ProcessPayment(ProcessPayment request)
        {
            Console.WriteLine($"[PaymentGrain] Processing payment: ${request.Amount}");
            await Task.Delay(100);

            return new PaymentResponse(true, $"TXN-{DateTimeOffset.Now.ToUnixTimeMilliseconds()}");
        }
    }

    // ShippingGrain: 배송 처리
    public class ShippingGrain : IShippingGrain
    {
        private readonly Dictionary<string, (string Status, string Address)> _shipments = new();

        public async Task ShipOrder(ShipOrder request)
        {
            Console.WriteLine($"[ShippingGrain] Shipping order {request.OrderId} to {request.Address}");
            _shipments[request.OrderId] = ("shipped", request.Address);
        }

        public Task<string> GetStatus(string orderId)
        {
            return Task.FromResult(
                _shipments.TryGetValue(orderId, out var shipment)
                    ? shipment.Status
                    : "not_found"
            );
        }
    }

    // NotificationGrain: 알림 처리
    public class NotificationGrain : INotificationGrain
    {
        private readonly string _name;

        public NotificationGrain() : this("Notifier") { }

        public NotificationGrain(string name)
        {
            _name = name;
        }

        public Task Notify(Notify notification)
        {
            Console.WriteLine($"[{_name}] Received notification: {notification.Message}");
            return Task.CompletedTask;
        }
    }

    // ============================================
    // Broadcast 헬퍼
    // ============================================

    public static class Broadcaster
    {
        public static async Task BroadcastToAll<T>(IEnumerable<T> grains, Func<T, Task> action)
        {
            var tasks = new List<Task>();
            foreach (var grain in grains)
            {
                tasks.Add(action(grain));
            }
            await Task.WhenAll(tasks);
        }
    }

    // ============================================
    // 메인 프로그램
    // ============================================

    public class Program
    {
        public static async Task Main(string[] args)
        {
            Console.WriteLine("=== Message Passing Patterns Demo (C#) ===\n");

            // Grain 등록
            GrainFactory.RegisterGrain(new OrderGrain());
            GrainFactory.RegisterGrain(new PaymentGrain());
            GrainFactory.RegisterGrain(new ShippingGrain());

            Console.WriteLine("--- 1. Tell Pattern (Fire-and-Forget) ---\n");

            // Ask 패턴으로 주문 생성 (내부적으로 Tell 사용)
            var orderGrain = GrainFactory.GetGrain<OrderGrain>("order");
            var orderResult = await orderGrain.CreateOrder(new CreateOrder("ORD-001", 99.99m));
            Console.WriteLine($"Order created: {orderResult.OrderId}, Status: {orderResult.Status}");

            await Task.Delay(500);

            Console.WriteLine("\n--- 2. Ask Pattern (Request-Response) ---\n");

            // Ask 패턴: 응답 대기
            var paymentGrain = GrainFactory.GetGrain<PaymentGrain>("payment");
            var paymentResult = await paymentGrain.ProcessPayment(new ProcessPayment("ORD-002", 150.0m));
            Console.WriteLine($"Payment result: Success={paymentResult.Success}, TxnID={paymentResult.TransactionId}");

            Console.WriteLine("\n--- 3. Broadcast Pattern ---\n");

            // Broadcast 설정
            var notifiers = new List<NotificationGrain>
            {
                new NotificationGrain("Notifier-1"),
                new NotificationGrain("Notifier-2"),
                new NotificationGrain("Notifier-3")
            };

            Console.WriteLine($"[Broadcaster] Broadcasting to {notifiers.Count} actors");

            // Broadcast: 모든 notifier에게 Tell
            await Broadcaster.BroadcastToAll(notifiers, n =>
                n.Notify(new Notify("System maintenance in 5 minutes")));

            await Task.Delay(200);

            Console.WriteLine("\n=== Demo Complete ===");
        }
    }
}
