---
title: 高并发抢单系统设计：从 Redis 原子判重到 MySQL 最终一致性的 Java 实践
date: 2026-09-16 10:00:00
categories:
  - 后端
tags:
  - Java
  - Spring Boot
  - Redis
  - MySQL
  - 高并发
  - 抢单
---

抢单系统的难点，不是把 `UPDATE` 语句写得足够快，而是让几十万请求同时到达时，系统仍然满足三个约束：**一个订单最多一个赢家、用户重试不会重复抢、最终结果可追踪、可修复**。

这篇文章给出一套可以直接落地的 Java 技术方案：Redis 负责瞬时裁决，Redis Stream 或消息队列负责串行化写入，MySQL 负责最终事实，定时任务负责最终一致性。文中的代码以 Spring Boot + Lettuce + Redis Cluster + MySQL 为例。

<!-- more -->

## 一、先明确抢单的语义

不同业务里的“抢单”可能有两种模型：

| 模型 | 示例 | 核心约束 |
| --- | --- | --- |
| 单资源归属 | 一个外卖订单只能被一个骑手抢到 | 同一个 `orderId` 只能有一个赢家 |
| 批量库存 | 一百张优惠券被很多用户抢 | 成功数量不能超过库存，且同一用户可配置限购 |

下面的方案以单资源归属为主线，批量库存只需要把“订单状态”替换成“活动库存 + 成功集合”，核心思想完全一致。

一个可接受的用户侧流程是：

1. 用户点击抢单，服务端快速返回 `202 Accepted` 和 `claimId`；
2. 页面显示“排队中”，轮询或通过 WebSocket 获取结果；
3. 只有 MySQL 事务提交后，才把状态推进到 `ASSIGNED`；
4. 重复请求使用同一个幂等键，拿回同一个结果。

这里的强一致对象不是“所有请求立即看到最终状态”，而是“**不重复归属、不超卖、最终可修复**”。对抢单这种极短窗口的场景，先把最热的判断放到 Redis，再用消息系统削峰，是更合理的取舍。

## 二、容量估算与目标

假设一次活动有 10 万用户同时抢 5 千个订单，峰值请求可能达到 20 万 QPS。真正会进入数据库的请求，只有 Redis 裁决成功的 5 千个左右，失败请求应该在 Redis 层直接结束。

可以给系统定一组可验证的目标：

| 指标 | 建议目标 |
| --- | --- |
| 网关 P99 | 小于 10 ms |
| Redis 裁决 P99 | 小于 20 ms |
| 用户拿到排队结果 | 小于 300 ms |
| 最终归属确认 | 正常时 1 s 内，异常时可降级 |
| 重复归属 | 0 |
| 超卖 | 0 |
| 已受理但永久丢失 | 0，通过补偿任务修复 |

容量上不要平均分配：热点订单和普通订单的请求密度可能相差几个数量级。Redis Cluster 至少做多分片、多副本，客户端使用 Lettuce，并设置合理的命令超时、重连和拓扑刷新参数。数据库连接池不能因为 Redis 快就无限放大，否则数据库故障时会把压力转成连接风暴。

## 三、总体架构

```text
Client
  |
  v
CDN/WAF -> Spring Cloud Gateway
              | 鉴权、限流、参数校验
              v
        Claim Service（无状态）
              | EVALSHA
              v
        Redis Cluster
        ├─ 订单裁决状态
        ├─ 幂等记录
        └─ 抢单事件 Stream
              |
              | consumer group
              v
        订单消费者 / MySQL Shard
              |
              v
         Kafka / WebSocket / 推送
```

各层职责要划清楚：

- 网关只做鉴权、基础参数校验、限流和流量染色，不查 MySQL；
- 抢单服务只做 Redis 原子裁决，不直接在热点路径上更新订单表；
- Redis Stream 或 Kafka 负责把已受理事件可靠地交给消费者；
- 消费者在事务中写 MySQL，成功后更新 Redis 最终状态；
- 通知系统只消费数据库确认后的事件，不能把“Redis 赢了”直接当成最终成功。

### 为什么不用数据库行锁硬扛

如果每个请求执行：

```sql
UPDATE trade_order
SET winner_user_id = ?
WHERE id = ? AND winner_user_id IS NULL;
```

同一订单的所有请求都会竞争同一行锁。QPS 高时，大量线程堆积在数据库连接池和 InnoDB 锁等待上，Redis、网关再快也无法解决问题。这个 SQL 不是错的，它适合作最后一道防线，但不适合作为入口裁决。

同样，不建议用 `synchronized`、本地锁或单个 Redis 分布式锁来解决热点订单问题。前者只能锁住单个 JVM，后者会把所有请求串行化，并且还要处理锁超时、续期和故障恢复。

## 四、Redis 数据结构设计

Redis 里的每个订单需要保存一组状态。为了兼容 Redis Cluster，所有参与同一个 Lua 脚本的 key 必须落在同一个哈希槽中，因此用分区号作为 hash tag：

```text
order:{p:12}:10086:state
claim:stream:{p:12}
claim:idem:{p:12}:user_7:request_abc
```

其中 `p:12` 是根据订单 ID 计算出的逻辑分区，例如 `Math.floorMod(Long.hashCode(orderId), 64)`。订单状态、事件流和幂等键使用同一个 tag，Lua 脚本才可以在集群环境下执行。

订单状态 Hash 至少包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `status` | `AVAILABLE`、`CLAIMING`、`ASSIGNED`、`SOLD`、`CLOSED`、`FAILED` |
| `winner` | 当前赢家用户 ID |
| `requestId` | 当前请求 ID，用于识别幂等重试 |
| `claimId` | 全局追踪 ID |
| `leaseUntil` | 处理租约截止时间，防止消费者异常时永久卡住 |
| `version` | 状态版本，防止旧消费者覆盖新状态 |

状态流转必须单向：

```text
AVAILABLE -> CLAIMING -> ASSIGNED
                  |
                  +-> FAILED / RELEASED
```

`sold` 不是业务成功状态，而是“这个订单已经被别人锁定或已经售出”的外部结果。`AVAILABLE` 只表示 Redis 当前允许尝试，不等于数据库已经成功分配。

## 五、Lua：一次原子裁决完成四件事

Lua 脚本的价值不是“看起来高级”，而是让下面这些动作在一次 Redis 原子执行中完成：

1. 判断订单是否可抢；
2. 判断是不是同一个幂等请求；
3. 写入 `CLAIMING` 和赢家信息；
4. 将事件写入 Stream。

核心脚本可以写成这样：

```lua
-- KEYS[1] order state
-- KEYS[2] claim stream
-- KEYS[3] idempotency key
-- ARGV[1] userId
-- ARGV[2] requestId
-- ARGV[3] claimId
-- ARGV[4] nowMillis
-- ARGV[5] leaseMillis
-- ARGV[6] orderId

local state = redis.call('HMGET', KEYS[1], 'status', 'winner', 'requestId', 'claimId')
local status = state[1]

if status == 'ASSIGNED' or status == 'CLAIMING' then
  if state[2] == ARGV[1] and state[3] == ARGV[2] then
    return 2 -- 幂等重试，返回已受理
  end
  return 0 -- 已被别人抢走
end

if status ~= 'AVAILABLE' then
  return 0
end

local oldIdem = redis.call('GET', KEYS[3])
if oldIdem then
  if oldIdem == ARGV[3] then
    return 2
  end
  return 3 -- 同一个幂等键被用于不同请求
end

redis.call('HSET', KEYS[1],
  'status', 'CLAIMING',
  'winner', ARGV[1],
  'requestId', ARGV[2],
  'claimId', ARGV[3],
  'leaseUntil', tostring(tonumber(ARGV[4]) + tonumber(ARGV[5])))

redis.call('SET', KEYS[3], ARGV[3], 'EX', 86400)
redis.call('XADD', KEYS[2], '*',
  'orderId', ARGV[6],
  'userId', ARGV[1],
  'requestId', ARGV[2],
  'claimId', ARGV[3])

return 1 -- 首次受理
```

返回值不要直接映射成 HTTP 成功或失败，而应该映射成稳定的业务状态：

- `1`：首次受理，返回 `202 + QUEUED`；
- `2`：同一请求重试，返回同一个 `claimId` 和当前状态；
- `0`：订单不可抢，返回 `409`；
- `3`：幂等键冲突，返回参数错误或要求客户端换键。

有几个生产细节必须注意：

- Lua 脚本中的多个 key 必须同槽，否则 Redis Cluster 会直接报错；
- Redis Lua 出错时不会像数据库事务那样整体回滚，脚本越短越安全；
- 不要在脚本里遍历大集合，也不要把 `KEYS` 当业务查询；
- 使用 `EVALSHA` 执行，Spring 的 `DefaultRedisScript` 会自动处理脚本缓存和降级；
- 订单状态预热失败时，宁可拒绝请求，也不要让脚本把未知状态当成可抢。

## 六、Java 侧如何调用

抢单接口可以设计成异步受理接口，不要把 Redis 裁决包装成“最终成功”：

```java
@PostMapping("/api/v1/orders/{orderId}/claims")
public ClaimResponse claim(
        @PathVariable long orderId,
        @RequestHeader("Idempotency-Key") String requestId,
        Authentication authentication) {

    long userId = currentUserId(authentication);
    int partition = Math.floorMod(Long.hashCode(orderId), 64);
    String tag = "{p:" + partition + "}";

    String stateKey = "order:" + tag + ":" + orderId + ":state";
    String streamKey = "claim:stream:" + tag;
    String idemKey = "claim:idem:" + tag + ":" + userId + ":" + requestId;
    String claimId = UUID.randomUUID().toString();

    Long code = redisTemplate.execute(
            CLAIM_SCRIPT,
            List.of(stateKey, streamKey, idemKey),
            String.valueOf(userId),
            requestId,
            claimId,
            String.valueOf(System.currentTimeMillis()),
            String.valueOf(10_000),
            String.valueOf(orderId));

    return switch (code.intValue()) {
        case 1 -> ClaimResponse.queued(claimId);
        case 2 -> claimQueryService.current(userId, orderId, requestId);
        case 0 -> ClaimResponse.soldOut();
        default -> throw new IllegalArgumentException("idempotency key conflict");
    };
}
```

这段代码里有两个很关键的约束：

- `requestId` 应该由客户端生成并在重试时保持不变，服务端还要校验请求体摘要，避免同一个键对应不同订单或不同参数；
- `userId` 必须从登录态中获取，不能直接相信请求体传入的用户 ID。

实际项目可以把 Redis 调用封装成一个 `ClaimGateway`，统一负责 key 生成、脚本加载、超时、异常转换和埋点。业务层只关心 `ACCEPTED`、`ALREADY_ACCEPTED`、`SOLD_OUT`、`CONFLICT` 四种结果。

## 七、消费者与 MySQL 写入

Redis 裁决成功后，消费者从 Stream 读取事件。消费者应该使用 consumer group，而不是让每个实例自己扫描列表：

```text
XREADGROUP GROUP claim-group consumer-1
  BLOCK 2000 COUNT 200
  STREAMS claim:stream:{p:12} >
```

消费事件的数据库事务可以简化为：

```java
@Transactional
public void persist(ClaimEvent event) {
    int inserted = claimMapper.insertIgnore(
        event.claimId(),
        event.orderId(),
        event.userId(),
        event.requestId()
    );

    if (inserted == 0) {
        ClaimRecord old = claimMapper.findByOrderId(event.orderId());
        if (old == null || !old.claimId().equals(event.claimId())) {
            throw new IllegalStateException("duplicate claim with different owner");
        }
        return;
    }

    int updated = orderMapper.assign(
        event.orderId(),
        event.userId(),
        event.claimId()
    );

    if (updated == 0) {
        throw new IllegalStateException("order already assigned");
    }
}
```

对应表结构：

```sql
CREATE TABLE order_claim (
  id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  claim_id VARCHAR(64) NOT NULL,
  status TINYINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_id (order_id),
  UNIQUE KEY uk_user_request (user_id, request_id),
  UNIQUE KEY uk_claim_id (claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`uk_order_id` 是最终防线的核心，它保证同一个订单在数据库中不可能出现两个有效赢家。即使 Redis 因故障恢复、重复投递或人工操作产生重复事件，数据库也会拒绝第二个赢家。

消费者的执行顺序必须是：

1. 读取事件；
2. 开启 MySQL 事务并提交；
3. 执行 Redis 的 `MARK_ASSIGNED` 脚本；
4. Redis 更新成功后 `XACK`；
5. 发布“订单已归属”的下游事件。

**不要先 ACK 再写数据库。** 如果进程在两步之间崩溃，事件就永久丢失了。相反，数据库已经提交但 Redis 更新失败或 ACK 失败，事件会被重复消费，而数据库的唯一索引和 `claimId` 正好用于去重。

### 批量库存模型怎么写

如果抢的是活动库存，MySQL 侧通常写入一张 `grab_success` 表，至少包含：

```text
activity_id, user_id, request_id, claim_id
unique(activity_id, user_id)
unique(user_id, request_id)
unique(claim_id)
```

Redis 侧把订单状态 Hash 换成活动库存 Hash：

```text
HSET activity:{p:12}:1001 stock 1000 status OPEN
```

在 Lua 里先判断 `stock > 0`，再原子执行 `HINCRBY stock -1` 并写入成功事件。不能先 `GET`、再在 Java 里判断、最后 `DECR`，因为这是两个独立命令，会在并发下超卖。

## 八、幂等、重试和状态查询

抢单系统的请求重试非常常见：用户连续点击、移动网络重发、网关超时重试、消费者重复投递。幂等要分两层做：

- **请求层**：`userId + orderId + requestId` 唯一，重复请求返回同一个 `claimId`；
- **事件层**：`claimId` 唯一，重复消息只允许执行一次业务副作用。

状态查询接口要根据 `claimId` 返回同一个结果，而不是重新抢一次：

```text
GET /api/v1/claims/{claimId}

QUEUED     已受理，等待数据库确认
ASSIGNED   已确认归属
FAILED     裁决失败或补偿完成
UNKNOWN    系统超时，正在自动核对
```

`UNKNOWN` 不应被当成失败。很多线上事故不是“数据写错”，而是客户端看到超时后立即重新抢单，造成新的竞争。服务端应该让同一幂等键查询继续返回原状态，直到补偿任务给出最终结果。

## 九、失败处理与补偿

高并发系统一定要先设计失败，而不是只设计成功路径。

### 1. Redis 主节点故障

Redis 故障时，客户端可能遇到超时或连接重置。此时客户端应使用原 `requestId` 重试；服务端无法确认上一次是否已受理时，返回 `503 + retryable=true`。不要在没有确认原请求状态时直接换新请求 ID，否则可能重复参与竞争。

生产环境建议：

- 开启 AOF，至少使用 `everysec`，并根据业务损失容忍度评估是否使用更高持久化等级；
- 每个主节点配置副本，使用 Redis Cluster 而不是单点；
- 监控 `rdb_last_bgsave_status`、AOF 重写、主从延迟和 failover 时间；
- 将 Redis 当作裁决层而不是唯一事实源，数据库和补偿任务负责最终修复。

### 2. Stream 消费积压

消费者数量不足、数据库变慢或通知系统故障都会让 Stream 堆积。需要监控：

- 每个 Stream 的长度；
- consumer group 的 `pending` 数量；
- 最老 pending 消息的等待时间；
- 消费失败率、重试次数和死信数量。

积压时可以先横向扩容消费者，但不能无限扩张数据库连接。更稳妥的方式是按分区消费、批量提交，并在数据库端限制单实例并发。

### 3. 消费者重复或乱序

Redis Stream 的消费者可能重复拿到同一条消息。数据库事务和唯一索引必须能承受重复执行，处理逻辑要满足：

- 同一个 `claimId` 重放不会增加库存；
- 同一个 `orderId` 只允许一个有效归属；
- 后到的旧事件不能覆盖新状态；
- 业务状态更新使用 `WHERE status = ?` 或版本号做条件更新。

### 4. 超时释放要谨慎

不要把“超过 1 秒没有写数据库”直接等同于失败并释放订单。消费者可能只是暂时 GC、网络抖动或数据库慢查询。更安全的状态机是：

```text
CLAIMING -> 消费者处理中
CLAIMING -> UNKNOWN -> 补偿任务核对数据库和 Stream
UNKNOWN  -> ASSIGNED
UNKNOWN  -> FAILED
UNKNOWN  -> RELEASED
```

释放操作也要通过 Lua 比较 `claimId` 和当前状态：

```lua
if redis.call('HGET', KEYS[1], 'claimId') ~= ARGV[1] then
  return 0
end
```

否则一个已经成功提交的订单，可能被旧补偿任务错误释放，随后又被第二个用户抢走。数据库唯一索引仍是最后一道保险，但用户会看到一次错误的“抢到了”再失败，体验很差。

## 十、限流、防刷和热点保护

网关层至少要有按用户、设备、IP 和接口维度的令牌桶限流。抢单接口可以配置为：

- 单用户单订单每秒 1 次；
- 单用户全局限速，避免脚本批量点击；
- 单 IP、单设备并发的宽松阈值，主要拦截异常流量；
- 全局入口限流，保护 Redis 和下游数据库。

限流器可以用 Redis 令牌桶 Lua 脚本实现，但在 Redis 故障时不能直接放行所有请求。更合理的降级是切换到本地 Caffeine 限流器，并降低全局入口配额。

还需要做：

- 登录态校验，用户 ID 只从服务端会话或 JWT 中取；
- 请求签名或一次性挑战，增加脚本伪造成本；
- 画像、设备指纹和频控规则，异常时触发验证码或排队页；
- 订单详情和活动信息走 CDN/本地缓存，避免所有流量集中打到数据库。

热点保护的关键不是把同一个订单拆成多个虚拟库存，而是尽快在 Redis 层拒绝失败请求，只让有限的成功事件进入数据库。

## 十一、可观测性与测试

每一条链路都要能回答两个问题：**这个 claimId 现在在哪里？为什么还没成功？**

建议埋点：

```text
claim_requests_total{result}
claim_lua_duration_seconds
claim_stream_length
claim_stream_pending
claim_consumer_retry_total
claim_db_duration_seconds
claim_assigned_total
claim_repair_total
claim_unknown_total
```

日志中至少带上 `traceId`、`claimId`、`orderId`、`userId`、`requestId`、状态和重试次数。不要把完整手机号、身份证号或敏感业务参数写进日志。

测试不能只做单接口压测，还要覆盖正确性：

1. 使用 Gatling 或 k6 模拟 10 万并发，抢 5 千个订单；
2. 故意让 30% 请求使用相同幂等键重复发送；
3. 压测后校验每单只有一个 `ASSIGNED`，成功数不超过库存；
4. 验证重复消息、消费者重启和 Redis 主从切换后数据仍然正确；
5. 注入 MySQL 延迟、消费者暂停、网络丢包，观察 backlog 是否最终收敛；
6. 统计 Redis evalsha P99、Stream pending、数据库写入 P99 和补偿数量。

一个简单的数据校验 SQL：

```sql
SELECT order_id, COUNT(*)
FROM order_claim
WHERE status = 10
GROUP BY order_id
HAVING COUNT(*) > 1;

SELECT COUNT(*)
FROM order_claim
WHERE status = 10;
```

第一条必须始终为空，第二条的规定应小于或等于可抢订单数。

## 十二、演进路线与落地清单

如果项目刚开始，不要一开始就上最复杂的分布式事务。可以按下面顺序演进：

1. 用 Redis Lua 完成原子裁决和幂等；
2. 用 Redis Stream 串行化成功事件，并让消费者写 MySQL；
3. 加数据库唯一索引、补偿任务和状态查询；
4. 当流量或合规要求提高后，把 Stream 替换为 Kafka/RocketMQ，并通过 outbox 或中继保证投递；
5. 最后再做多地域、多集群和更细粒度的容量治理。

上线前逐项检查：

- [ ] 单资源是否有数据库唯一约束？
- [ ] 批量库存是否在 Lua 中原子扣减？
- [ ] 是否禁止在热点路径上使用 Redis 分布式锁？
- [ ] 幂等键是否覆盖用户、订单和请求？
- [ ] 消费者是否在数据库提交后才 ACK？
- [ ] 是否能在不重新抢单的情况下查询原 claimId？
- [ ] Redis 故障、MySQL 变慢、消费者重启时是否有降级和补偿？
- [ ] 是否有限流、防刷、鉴权和请求体校验？
- [ ] 是否有 P99、pending、补偿次数和最终归属的监控？
- [ ] 是否用压测和故障注入验证过“不重复、不超卖”？

## 总结

高并发抢单的核心不是把数据库优化到极限，而是把系统拆成三层：

**Redis 做瞬时、原子、可重放的裁决；消息系统做削峰和可靠传递；MySQL 做最终事实和唯一性兜底。**

Java 服务保持无状态，Lua 脚本只处理最小状态转移，消费者在事务提交后再更新状态和 ACK，补偿任务负责修复不确定结果。做到这些之后，即使面对几十万 QPS、网络抖动和节点故障，系统仍然可以保持“同一个订单最终只有一个赢家”。
