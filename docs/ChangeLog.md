# ChangeLog

## 2026-10-04 设置页布局

- 去掉设置页的“外观”卡片（顶栏已有主题切换）。
- 设置页由瀑布流改为左右两列（左：路由、健康检查；右：日志与登录、服务、管理员密码），每列最后一张卡片撑满，两列底部对齐，保存按钮贴底。

## 2026-10-04 修复 Chat 流式首字延迟

- `/v1/chat/completions` 流式请求的首字延迟原来几乎都记为 0：节点第一块是空内容 `"content": ""`，被当成了首字。改为要求内容非空才算；新增对应测试，共 27 个通过。

## 2026-10-04 支持 Responses 接口，改名 Strata Router

- 新增 `/v1/responses`（OpenAI Responses 协议）：新模块 responses.py 把请求转成 Chat Completions 发给节点，再把结果与流式分块转回 Responses 格式（参考 new-api apicompat 的反向实现），支持思考摘要、工具调用、结构化输出、用量与缓存命中。不支持 `previous_response_id`。
- 请求日志记录协议为 responses，控制台请求详情显示“Responses”；Responses 流式的首字延迟按第一个实际增量计算。
- 控制台品牌、页面标题与文档中的 “Strata Cluster” 改为 “Strata Router”，启动日志同步改名。
- 新增 4 个测试（请求转换、非流式、流式事件序列、拒绝 previous_response_id），共 26 个全部通过；用 openai SDK 经临时入口对 win3080 实测非流式、流式、工具调用与回传工具结果均正常。

## 2026-10-04 README 加截图

- 新增 `docs/screenshots/` 下 5 张控制台截图（总览、节点、节点详情、请求详情、深色主题），README 新增“截图”一节。截图用模拟节点和示例数据生成，不含真实地址与请求内容。

## 2026-10-04 开源发布准备

- 新增 README.md 与 MIT 许可（LICENSE）。
- 示例配置与文档中的真实地址、访问密钥换成示例值。
- `strata-router.service` 改为本地文件不再跟踪，另提供通用模板 `strata-router.service.example`。

## 2026-10-04 界面细节

- 修复分段切换（顶部导航、设置里的选项）点击后选中底板消失：宽屏和手机两份导航共用了同一个动画标识，底板被交给了隐藏的那份；改为每个实例独立标识。选中样式保持与 Strata 一致（白底、黑字加粗、卡片阴影）。
- 总览节点区节点数不是 3 的倍数时补一张“添加节点”虚线卡片；只有一个节点时改为两列，避免右侧大块空白。

## 2026-10-04 改版为集群管理产品（第一期）

- 新增产品规划 docs/产品规划.md；需求说明按新功能重写。
- 后端拆分为 core.py（节点、路由、健康检查）、store.py（SQLite）、admin.py（管理接口）、router.py（入口与转发）：后台健康检查与指标采集、节点启用 / 排空 / 停用与权重、多个访问密钥（哈希存储）、管理员密码登录、请求日志（用量、缓存命中、首字延迟、耗时、错误、路由决策快照）、事件记录、按权重策略、设置在线修改。
- 控制台重做为 Strata 风格：总览、节点（含详情抽屉与硬件指标）、请求、密钥、设置、登录页，浅色 / 深色主题。
- 内容摘要去掉 Claude Code 的 `<system-reminder>`；服务刚启动时的首次在线不再记为事件。
- 修复：systemd 原用系统 Python 3.8，不支持 `dict | dict`，管理接口断开连接；改用 Python 3.12，并让管理接口在意外错误时返回 500 且记录堆栈。
- 测试 22 个全部通过；真机验证：Claude Code 经入口的请求用量与 Strata 自身记录一致（提示 29836、输出 32），排空 jasper 后新会话全部分到 win3080。

## 2026-10-04 管理页与固定前缀剔除

- 新增管理页 `/admin`（web/，React + Tailwind + shadcn/ui + Framer Motion）：机器状态实时查看、添加、删除。
- `/router/status` 增加各机器当前阶段、提示/生成 token、上限、耗时、速度。
- 换机器判断剔除固定前缀：目标机器最近处理过相同的系统提示 + 工具列表时，只按对话部分估算重读量（Claude Code 首轮约 4 万 token 的估算中大部分是这部分）。日志显示 `固定~N`，换机原因显示 `moved(~N)`。
- 测试增至 11 个，全部通过。

## 2026-10-04 初版

- 新增 router.py（仅标准库）：多机 Strata 统一入口，空闲优先、会话粘性、短会话忙时换机、分配策略可配（even 默认 / least_load / random）、掉线跳过、流式直通。
- 支持运行中动态增删机器（`POST /router/backends`、`DELETE /router/backends/<名字>`，写回 config.json），以及 config.json 修改后自动重载。
- 新增 test_router.py（9 个用例，全部通过）与 systemd 用户服务 strata-router.service（端口 8099）。
- 真机验证：经入口的 Anthropic 流式、同会话第二轮（粘性回到原机器）、OpenAI 请求、Claude Code `-p` 均正常；jasper 当时忙，请求均分到空闲的 win3080。
