# Endpoint Navigator

在 Java 项目中搜索并跳转各类接口入口。不依赖任何 Java 语言服务器，改用自研的字符级注解解析，因此可以独立工作。

## 支持的类型

| 类型 | 识别方式 |
| --- | --- |
| REST | `@RestController` / `@Controller` + `@GetMapping` / `@PostMapping` / `@RequestMapping` 等 |
| WebSocket | STOMP `addEndpoint` / `@MessageMapping` / `@SendTo` / `convertAndSend` |
| xxl-job | `@XxlJob("handlerName")` |
| MQ | `@RabbitListener` / `@KafkaListener` / `@RocketMQMessageListener` |
| 定时任务 | `@Scheduled` |
| Mapper | `@Mapper` 或 `extends BaseMapper` |
| 自定义 | 通过 `endpointNavigator.customRules` 配置正则，接入 Netty 等任意框架 |

## 用法

- `Ctrl+Alt+E`（macOS `Cmd+Alt+E`）打开搜索面板
- 顶部标签栏按类型过滤，`ALL` 为全部
- 搜索框支持：路径、中文描述（Swagger `@ApiOperation`）、类名、方法名
- 空格分隔多个关键词，结果为 AND 关系
- 点击 `.*` 或输入 `re:` 前缀启用正则
- `↑` `↓` 选择，`Enter` 跳转，`Esc` 清空/关闭

命令面板还提供 `Endpoint Navigator: 快速搜索（QuickPick）` 与 `Endpoint Navigator: 重建索引`。

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
