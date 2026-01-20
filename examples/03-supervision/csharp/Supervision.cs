// Supervision Pattern - 감독 트리 예제 in C#
// Orleans/Akka.NET 스타일로 구현

using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace SupervisionExample
{
    // ============================================
    // 감독 전략 정의
    // ============================================

    public enum Directive
    {
        Resume,     // 상태 유지하고 계속
        Restart,    // 상태 초기화 후 재시작
        Stop,       // 종료
        Escalate    // 부모에게 전파
    }

    public delegate Directive Decider(Exception error);

    public class SupervisorStrategy
    {
        public string Type { get; init; } = "one-for-one";
        public int MaxRetries { get; init; } = 3;
        public TimeSpan WithinDuration { get; init; } = TimeSpan.FromMinutes(1);
        public Decider Decider { get; init; } = _ => Directive.Escalate;
    }

    // ============================================
    // 재시작 통계
    // ============================================

    public class RestartStatistics
    {
        private readonly List<DateTime> _failures = new();
        private readonly int _maxRetries;
        private readonly TimeSpan _withinDuration;
        private readonly object _lock = new();

        public RestartStatistics(int maxRetries, TimeSpan withinDuration)
        {
            _maxRetries = maxRetries;
            _withinDuration = withinDuration;
        }

        public bool RecordFailure()
        {
            lock (_lock)
            {
                var now = DateTime.UtcNow;
                _failures.Add(now);

                // 시간 범위 내의 실패만 유지
                _failures.RemoveAll(t => now - t > _withinDuration);

                return _failures.Count <= _maxRetries;
            }
        }

        public void Reset()
        {
            lock (_lock)
            {
                _failures.Clear();
            }
        }
    }

    // ============================================
    // 에러 타입 정의
    // ============================================

    public class TransientException : Exception
    {
        public TransientException(string message) : base(message) { }
    }

    public class DatabaseException : Exception
    {
        public DatabaseException(string message) : base(message) { }
    }

    public class FatalException : Exception
    {
        public FatalException(string message) : base(message) { }
    }

    // ============================================
    // Actor 기본 클래스
    // ============================================

    public abstract class SupervisedActor
    {
        protected readonly string Name;
        protected readonly Dictionary<string, SupervisedActor> Children = new();
        protected SupervisedActor? Parent;
        protected readonly SupervisorStrategy? Strategy;
        protected readonly Dictionary<string, RestartStatistics> RestartStats = new();
        protected bool IsRunning = true;
        protected readonly object Lock = new();

        protected SupervisedActor(string name, SupervisorStrategy? strategy = null)
        {
            Name = name;
            Strategy = strategy;
        }

        public SupervisedActor Spawn(string name, SupervisedActor child)
        {
            lock (Lock)
            {
                child.Parent = this;
                Children[name] = child;

                if (Strategy != null)
                {
                    RestartStats[name] = new RestartStatistics(
                        Strategy.MaxRetries,
                        Strategy.WithinDuration);
                }

                Console.WriteLine($"[{Name}] Spawned child: {name}");
                child.PreStart();
                return child;
            }
        }

        public void Send(object message)
        {
            if (!IsRunning)
            {
                Console.WriteLine($"[{Name}] Actor is stopped, message dropped");
                return;
            }

            try
            {
                Receive(message);
            }
            catch (Exception ex)
            {
                HandleFailure(ex, message);
            }
        }

        protected abstract void Receive(object message);

        protected virtual void PreStart()
        {
            Console.WriteLine($"[{Name}] Starting...");
        }

        protected virtual void PostStop()
        {
            Console.WriteLine($"[{Name}] Stopped");
        }

        protected virtual void PreRestart(Exception reason)
        {
            Console.WriteLine($"[{Name}] Restarting due to: {reason.Message}");
            foreach (var child in Children.Values)
            {
                child.Stop();
            }
            PostStop();
        }

        protected virtual void PostRestart(Exception reason)
        {
            PreStart();
            Console.WriteLine($"[{Name}] Restarted");
        }

        private void HandleFailure(Exception error, object message)
        {
            Console.WriteLine($"[{Name}] Failed with: {error.Message}");

            if (Parent != null)
            {
                Parent.Supervise(Name, error, message);
            }
            else
            {
                Console.WriteLine($"[{Name}] Root actor failure");
                Stop();
            }
        }

        protected void Supervise(string childName, Exception error, object message)
        {
            SupervisedActor? child;
            lock (Lock)
            {
                if (!Children.TryGetValue(childName, out child) || Strategy == null)
                    return;
            }

            var directive = Strategy.Decider(error);
            Console.WriteLine($"[{Name}] Supervising {childName}: {directive}");

            switch (directive)
            {
                case Directive.Resume:
                    Console.WriteLine($"[{Name}] Resuming {childName}");
                    break;

                case Directive.Restart:
                    HandleRestart(childName, child, error);
                    break;

                case Directive.Stop:
                    HandleStop(childName, child);
                    break;

                case Directive.Escalate:
                    Parent?.Supervise(Name, error, message);
                    break;
            }
        }

        private void HandleRestart(string childName, SupervisedActor child, Exception error)
        {
            RestartStatistics? stats;
            lock (Lock)
            {
                RestartStats.TryGetValue(childName, out stats);
            }

            if (stats != null && !stats.RecordFailure())
            {
                Console.WriteLine($"[{Name}] Max retries exceeded for {childName}, stopping");
                HandleStop(childName, child);
                return;
            }

            if (Strategy?.Type == "all-for-one")
            {
                Console.WriteLine($"[{Name}] All-for-one: restarting all children");
                lock (Lock)
                {
                    foreach (var c in Children.Values)
                    {
                        c.PreRestart(error);
                        c.PostRestart(error);
                    }
                }
            }
            else
            {
                child.PreRestart(error);
                child.PostRestart(error);
            }
        }

        private void HandleStop(string childName, SupervisedActor child)
        {
            child.Stop();
            lock (Lock)
            {
                Children.Remove(childName);
                RestartStats.Remove(childName);
            }
        }

        public void Stop()
        {
            List<SupervisedActor> childrenToStop;
            lock (Lock)
            {
                IsRunning = false;
                childrenToStop = new List<SupervisedActor>(Children.Values);
                Children.Clear();
            }

            foreach (var child in childrenToStop)
            {
                child.Stop();
            }
            PostStop();
        }
    }

    // ============================================
    // Actor 구현
    // ============================================

    public class WorkerActor : SupervisedActor
    {
        private int _jobCount = 0;

        public WorkerActor(string name) : base(name) { }

        protected override void Receive(object message)
        {
            if (message is ProcessJob job)
            {
                _jobCount++;
                Console.WriteLine($"[{Name}] Processing job #{_jobCount}: {job.Data}");

                if (job.Data == "transient_error")
                {
                    throw new TransientException("Temporary network issue");
                }
                if (job.Data == "fatal_error")
                {
                    throw new FatalException("Critical system failure");
                }

                Console.WriteLine($"[{Name}] Job #{_jobCount} completed");
            }
        }

        protected override void PreRestart(Exception reason)
        {
            Console.WriteLine($"[{Name}] Saving state before restart... (jobs processed: {_jobCount})");
            base.PreRestart(reason);
        }

        protected override void PostRestart(Exception reason)
        {
            _jobCount = 0;
            base.PostRestart(reason);
        }
    }

    public class DatabaseActor : SupervisedActor
    {
        private readonly int _connectionPool = 5;

        public DatabaseActor(string name) : base(name) { }

        protected override void Receive(object message)
        {
            if (message is QueryMessage query)
            {
                Console.WriteLine($"[{Name}] Executing query: {query.Sql}");

                if (query.Sql == "bad_query")
                {
                    throw new DatabaseException("Query syntax error");
                }

                Console.WriteLine($"[{Name}] Query completed");
            }
        }

        protected override void PreRestart(Exception reason)
        {
            Console.WriteLine($"[{Name}] Keeping connection pool: {_connectionPool}");
        }
    }

    public class WorkerSupervisor : SupervisedActor
    {
        private readonly Random _random = new();

        public WorkerSupervisor() : base("WorkerSupervisor", new SupervisorStrategy
        {
            Type = "one-for-one",
            MaxRetries = 3,
            WithinDuration = TimeSpan.FromMinutes(1),
            Decider = error => error switch
            {
                TransientException => Directive.Restart,
                FatalException => Directive.Stop,
                _ => Directive.Escalate
            }
        })
        { }

        protected override void Receive(object message)
        {
            if (message is DispatchJob dispatch)
            {
                List<SupervisedActor> workers;
                lock (Lock)
                {
                    workers = new List<SupervisedActor>(Children.Values);
                }

                if (workers.Count > 0)
                {
                    var worker = workers[_random.Next(workers.Count)];
                    worker.Send(new ProcessJob(dispatch.Data));
                }
            }
        }

        public void InitWorkers(int count)
        {
            for (int i = 1; i <= count; i++)
            {
                var name = $"Worker-{i}";
                Spawn(name, new WorkerActor(name));
            }
        }
    }

    public class RootSupervisor : SupervisedActor
    {
        public RootSupervisor() : base("RootSupervisor", new SupervisorStrategy
        {
            Type = "one-for-one",
            MaxRetries = 5,
            WithinDuration = TimeSpan.FromMinutes(1),
            Decider = error =>
            {
                Console.WriteLine($"[RootSupervisor] Deciding for error type");
                return error switch
                {
                    DatabaseException => Directive.Resume,
                    _ => Directive.Restart
                };
            }
        })
        { }

        protected override void Receive(object message)
        {
            Console.WriteLine($"[{Name}] Received: {message}");
        }
    }

    // ============================================
    // 메시지 타입
    // ============================================

    public record ProcessJob(string Data);
    public record DispatchJob(string Data);
    public record QueryMessage(string Sql);

    // ============================================
    // 메인 프로그램
    // ============================================

    public class Program
    {
        public static async Task Main()
        {
            Console.WriteLine("=== Supervision Pattern Demo (C#) ===\n");

            // 감독 트리 구성
            var root = new RootSupervisor();
            root.Send(null!); // PreStart trigger

            var workerSupervisor = (WorkerSupervisor)root.Spawn("WorkerSupervisor", new WorkerSupervisor());
            var database = root.Spawn("Database", new DatabaseActor("Database"));

            workerSupervisor.InitWorkers(3);

            Console.WriteLine("\n--- 1. Normal Operation ---\n");

            workerSupervisor.Send(new DispatchJob("job-1"));
            workerSupervisor.Send(new DispatchJob("job-2"));
            database.Send(new QueryMessage("SELECT * FROM users"));

            await Task.Delay(100);

            Console.WriteLine("\n--- 2. Transient Error (Restart) ---\n");

            workerSupervisor.Send(new DispatchJob("transient_error"));

            await Task.Delay(100);

            Console.WriteLine("\n--- 3. Database Error (Resume) ---\n");

            database.Send(new QueryMessage("bad_query"));

            await Task.Delay(100);

            Console.WriteLine("\n--- 4. Normal Operation After Recovery ---\n");

            workerSupervisor.Send(new DispatchJob("job-3"));
            database.Send(new QueryMessage("SELECT * FROM orders"));

            await Task.Delay(100);

            Console.WriteLine("\n--- 5. Fatal Error (Stop) ---\n");

            workerSupervisor.Send(new DispatchJob("fatal_error"));

            await Task.Delay(100);

            Console.WriteLine("\n--- 6. System Shutdown ---\n");

            root.Stop();

            Console.WriteLine("\n=== Demo Complete ===");
        }
    }
}
