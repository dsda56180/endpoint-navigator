# 更新日志

## 0.4.0

### 新增

- 重复接口检测：识别同 method + 同 path 的映射，路径归一化处理大小写与尾斜杠
- 首次检测到冲突时弹出提示，状态栏 tooltip 同步显示冲突组数
- 命令「检查重复接口」：QuickPick 列出冲突组，选中直接定位
- 命令「导出接口清单」：支持 Markdown 表格与 JSON

## 0.3.0

### 新增

- CodeLens：在 Controller 方法上方显示完整接口路径，点击打开搜索面板并预填
- `endpointNavigator.codeLens.enabled` 配置项，大项目可关闭
- 启动时自动构建索引（仅当工作区存在 Java 文件），状态栏与 CodeLens 无需手动触发

## 0.2.0

### 新增

- 搜索结果命中片段高亮：普通模式按关键词，正则模式按匹配区间
- 结果行右键菜单：复制路径、复制 `类#方法`、复制为 cURL、复制 `文件:行`
- 结果超过 500 条时提供「显示全部」按钮
- 扩展图标

### 变更

- 空状态按场景区分：未输入、无匹配、当前标签页无匹配

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
