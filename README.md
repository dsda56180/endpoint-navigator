# Endpoint Navigator

在 Java 项目中搜索并跳转各类接口入口。不依赖任何 Java 语言服务器，改用自研的字符级注解解析，因此可以独立工作。

## English

Endpoint Navigator indexes every HTTP, WebSocket, xxl-job, MQ, scheduled-task and MyBatis Mapper entry point in a Java workspace, then lets you search them from one panel. It parses annotations character by character instead of relying on a Java language server, so it works even when no JDK or Spring tooling is configured.

- Search by URL, Swagger description (Chinese included), class or method name
- Multiple space-separated keywords are ANDed; `re:` prefix or the `.*` button enables regular expressions
- Subsequence fuzzy matching (`fomd` → `updateIntervalFromDatabase`) with character-level highlighting
- Filters: `method:GET`, `kind:rest`, exclusions: `-delete`
- CodeLens shows the full path above each controller method
- Hovering a mapping annotation previews the resolved path, description and duplicate warnings
- Three switchable layouts: classic list, card and compact
- Shows Swagger tags and can group results by tag
- Indexes OpenFeign clients and outgoing RestTemplate / WebClient / Hutool / OkHttp calls, resolving constants, `@Value` fields and `${...}` config placeholders
- Export to OpenAPI 3.0 for Postman, Apifox, Insomnia and Swagger UI
- Duplicate route detection, Markdown/JSON export of the current result set
- Incremental, cached indexing with file watching

## 支持的类型

| 类型 | 识别方式 |
| --- | --- |
| REST | `@RestController` / `@Controller` + `@GetMapping` / `@PostMapping` / `@RequestMapping` 等 |
| WebSocket | STOMP `addEndpoint` / `@MessageMapping` / `@SendTo` / `convertAndSend` |
| xxl-job | `@XxlJob("handlerName")` |
| MQ | `@RabbitListener` / `@KafkaListener` / `@RocketMQMessageListener` |
| 定时任务 | `@Scheduled` |
| Mapper | `@Mapper` 或 `extends BaseMapper` |
| Feign | `@FeignClient` 接口上的 `@GetMapping` / `@PostMapping` 等，服务名作为标签 |
| HTTP 调用 | `RestTemplate` / `WebClient` / Hutool `HttpUtil` / OkHttp `.url(...)` 调用点 |
| 自定义 | 通过 `endpointNavigator.customRules` 配置正则，接入 Netty 等任意框架 |

出站调用（Feign、HTTP 调用）会标记「出站」，路径支持类常量、`+` 拼接、`@Value` 注入字段以及 `application.yml` / `application.properties` 中的 `${key}` 占位符；无法解析的常量会保留在路径中并标注。

## 用法

- `Ctrl+Alt+E`（macOS `Cmd+Alt+E`）打开搜索面板
- 顶部标签栏按类型过滤，`ALL` 为全部
- 搜索框支持：路径、中文描述（Swagger `@ApiOperation`）、类名、方法名
- 空格分隔多个关键词，结果为 AND 关系
- 点击 `.*` 或输入 `re:` 前缀启用正则
- 条件过滤：`method:GET`、`kind:rest`；排除：`-delete`
- 面板右上「导出」按当前筛选条件导出，可选 Markdown、JSON 或 OpenAPI 3.0
- 搜索栏样式下拉可切换「经典 / 卡片 / 紧凑」三种布局，选择会记住
- 「分组」按钮按 Controller 的 Swagger 标签分组展示，组头吸顶显示数量
- 悬浮 `@GetMapping` 等映射注解可预览完整路径、中文描述与冲突提示
- `↑` `↓` 选择，`Enter` 跳转，`Esc` 清空/关闭

命令面板还提供 `Endpoint Navigator: 快速搜索（QuickPick）` 与 `Endpoint Navigator: 重建索引`。

## 导入到 API 管理工具

「导出接口清单」选择 OpenAPI 3.0，生成 `endpoints.openapi.json` 后：

- Postman：Import → OpenAPI 3.0，按 module 自动生成文件夹
- Apifox：导入 → OpenAPI/Swagger，中文 `summary` 会成为接口名称
- Insomnia、Swagger UI、YApi 同理

导出内容只包含 REST 接口；请求体与 query 参数无法从注解推导，生成的是可直接发请求的接口骨架，`servers` 默认指向 `http://localhost:8080`。

## 解析能力

- 类级与方法级路径自动拼接为完整 URL
- `@GetMapping("/a")`、`@GetMapping(value = "/a")`、`@GetMapping({"/a", "/b"})` 均支持
- 跨行注解、`method = RequestMethod.POST`、`method = {GET, POST}` 均支持
- 本文件内的 `static final String` 常量会自动代入；解析不到时保留 `{常量名}` 并标注警告，不做猜测
- 正确处理字符串中的 `@`（如 `@PreAuthorize("@ss.hasPermi(...)")`）、注释与文本块

## 配置

```jsonc
{
  "endpointNavigator.enabledScanners": ["rest", "stomp", "xxljob", "messaging", "mybatis", "regexRule"],
  "endpointNavigator.includeGlobs": ["**/*.java"],
  "endpointNavigator.excludeGlobs": "**/{target,build,node_modules,out,dist,.git}/**",
  "endpointNavigator.contextPath": "",
  "endpointNavigator.showUnresolved": true,
  "endpointNavigator.customRules": [
    {
      "id": "netty",
      "label": "Netty",
      "pattern": "case\\s+(?<path>\\w+)\\s*:",
      "globs": ["**/*.java"]
    }
  ]
}
```

## License

MIT
