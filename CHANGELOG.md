# 更新日志

## 0.1.1

### 修复

- 搜索结果为空时，右上角计数仍显示上一次查询的残留数值
- 正则模式与大小写开关开启后，文字在暗色主题下与背景同色而不可见
- 删除 Java 文件后，索引缓存条目无法被清除

### 变更

- 打包产物排除 `.github` 目录，VSIX 文件数由 9 降至 8

## 0.1.0

### 新增

- 接口搜索面板（`Ctrl+Alt+E`），支持类型标签页筛选
- REST：Spring MVC 注解解析，自动合并类级与方法级路径
- WebSocket：STOMP 端点、`@MessageMapping`、`@SendTo`、`convertAndSend`
- xxl-job：`@XxlJob` 处理器名称
- MQ：`@RabbitListener` / `@KafkaListener` / `@RocketMQMessageListener`
- 定时任务：`@Scheduled`
- MyBatis Mapper：`@Mapper` 与 `extends BaseMapper`
- 自定义正则规则，用于接入 Netty 等框架
- Swagger2 / OpenAPI3 中文描述，可用中文反查接口
- 正则搜索（`.*` 开关或 `re:` 前缀）、多关键词 AND、子序列模糊匹配
- 文件保存后增量更新索引
