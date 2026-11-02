# 接收端API契约（源码/HTTP实查版）

2026-11-02，API路径/v1、响应schema_version=1.0。范围：同学列出的七个前端接口，加身份恢复及文件元信息；内部上传、领取、回传不是浏览器权限。新增附件描述为本机候选，现网仍按既有发布记录，今天只核对现网只读入口。

## 公共约定

HTTPS现网base URL见网络文档；本包HTTP记录来自独立127.0.0.1临时端口。JSON请求Content-Type必须application/json、UTF-8，当前JSON体上限65536字节；对象类型，非数组。JSON响应Content-Type为application/json; charset=utf-8。字段可扩展；不要按标题、owner或中文错误串当固定枚举。

实际错误结构为`{"error":"错误文字"}`，**没有**通用error.code/retryable对象。HTTP400参数/部分不存在资源，401机器权限缺失，403范围不足，404会话/数据集/路由不存在，409身份被替换或处理冲突，410文件已登记但本机不存在，413体积超限，415媒体类型错误，416Range错误，500内部错误；不是每项都在本包主动触发，具体已抓样例见记录。网关拒绝/断网不保证返回这个JSON，先判断Content-Type及状态。

500统一“服务器内部错误”；4xx和业务last_error不保证所有历史模块消息都完全脱敏，前端不要执行HTML或直接展示堆栈/任意内部路径。未知错误可给普通提示并保留HTTP状态供排查。本包没有正式ERROR_CODE枚举，不能按同学建议格式直接编程。

## 1 GET /api/v1/receiver-profiles

无参数，成功200。响应顶层schema_version/config_version:string，receiver_types/categories:array，可能附mission/members等字段；字段细节和嵌套结构见01-profiles.json与现网profiles.json。receiver_types[].roles已筛除selectable=false项。前端可完全按该接口生成力量/岗位，保留未知扩展字段。

当前有效组合：command_center→commander；air_group→uav_operator/helicopter_pilot；ground_group→ground_commander/frontline_responder/vehicle_driver。分类权限取roles[].categories；产品申请选项还受request_options及receiver_types限制，不能仅凭某一分类可见就假定所有产品已运行。

## 2 POST /api/v1/identity-selections

| 请求字段 | 类型 | 必填/默认/允许值 |
|---|---|---|
| terminal_id | string | 必填，3—100字符，正则[A-Za-z0-9_.:-]{3,100}；持久化本终端随机ID |
| receiver_type | string | 必填，取profiles允许值 |
| role_id | string | 必填，与力量组合必须有效 |
| display_name | string/null | 可选，默认null；现有页面不要求，提供时最长100字符 |
| person_id | string/null | 可选，默认null；当前无需绑定人员/签到；绑定需要既有任务人员信息 |

成功201，返回session_id:string、terminal_id、receiver_type/role_id及标签、person_id/display_name:null或string、mission_bound:boolean、categories/subscriptions:array、selected_at:string。可选access_scope只在绑定人员时出现。真实响应02-identity.json。

会话保存在数据库，**没有配置固定TTL或refresh_token**；同terminal_id重新选择身份会使旧会话active=0。不存在会话404，已替换409。GET /api/v1/identity-selections/{session_id}可用于恢复（参数为路径字符串）；刷新页面不一定重选，但现有JS薄客户端实例不会自动从存储恢复session，接入方需持久化并验证，失败再选择。岗位选择不是登录认证，当前网络入口限制不能等同正式账号权限。

## 3 GET /api/v1/receiver-catalog

| query | 类型 | 必填/默认 |
|---|---|---|
| session_id | string | 必填，当前有效会话 |
| category | string | 可选，默认该岗位第一个分类；只能为该岗位允许分类 |
| view | string | 可选，operational/research/all；正式非回放默认operational，回放默认all；SDK默认operational |

成功200。schema_version/session_id/receiver_type/role_id/selected_category/view:string，categories/items/product_templates/request_options/requests:array。items既可能为产品也可能为数据集卡，未必都有product_id；无附件产品也有summary。request_options提供真实可选request_type、默认参数和产物类型，需动态读取。真实03及16记录分别为完成前/后。

view不合法400；分类越权403；会话错误404/409。目录中的产品已按最新、用途、有效期和订阅规则筛选；不直接用全部/products列表代替人员目录。地图渲染与图表预览由调用方按附件契约完成。

## 4 POST /api/v1/processing-requests

| JSON字段 | 类型 | 必填/默认 |
|---|---|---|
| session_id | string | 必填，来自当前身份 |
| request_type | string | 必填，取目录request_options，不自行猜W编号 |
| parameters | object/null | 可省略/null；与目录default_parameters合并，省略字段保留默认值；所需参数看required_parameters |
| idempotency_key | string | 必填，非空、最长200字符；业务申请没有额外字符正则；建议UUID |

新建201、同键同请求复用200，返回请求对象；额外created:boolean。某些简报请求可同步完成或失败，**不能假定创建响应一定pending**。成功专题样例04、重复06；冲突07为400。

幂等键在processing_requests表全局唯一，不是每会话独立名字空间。没有独立TTL；记录存在期间保留。同键、同session_id、同request_type、相同合并参数返回原请求；不同session/类型/参数拒绝400。超时未知回执时保留当前会话、相同键及参数重新提交；切换身份后不可拿旧键当新申请。没有自动删库/回收期限承诺。

## 5 GET /api/v1/processing-requests/{request_id}

路径参数request_id:string，成功200。完整字段见03-实际响应字段清单及05/09/11/20记录。核心字段：request_id/status:string，result_product_id/last_error/worker_id/lease_expires_at/heartbeat_at:string或null，parameters:object，waiting_seconds/attempt_count:integer，progress_hint:string，requested_at/updated_at:string。

| 状态 | 含义/前端行为 |
|---|---|
| pending | 已入队，不等于程序已经运行；超过300秒可出现等待提示，不是自动超时失败 |
| running | 节点领取并持租约；租约到期可在下一次领取时回到pending或再次running，不能锁死单向进度 |
| completed | 通过产品登记完成；正常此时result_product_id非空，接着GET产品 |
| failed | 业务失败，HTTP仍可200；读last_error/progress_hint，停止正常轮询并提示，不无限重发 |

无cancelled状态和前端取消处理API；关闭侧栏/取消下载不会取消后端计算。completed不会由普通状态接口退回running/failed；结果有效期到期不会把completed改成failed。没有正式最长处理时间SLA，也没有任务保留天数；租约默认120秒、可30—3600秒是节点续租窗口，不是计算耗时上限。建议活跃请求约3秒轮询，隐藏/关闭后停止或降频；当前普通目录刷新约30秒，均非服务吞吐承诺。

找不到请求当前映射为400（ValueError），并非统一404；不要假设同学建议状态码已全部实现。前端应处理异常completed缺result_product_id为协议异常，不虚构链接。

## 6 GET /api/v1/products/{product_id}

路径product_id:string，成功200；未知产品当前400。核心返回product_id/product_type/category_id/title/summary/owner/version/processor_name/processor_version/product_key:string；request_id/task_id/valid_from/valid_until/threshold_version/quality_reason可能null；quality_status为usable/caution/unusable/unknown；extent/metadata:object，derived_from:array<string>，assets:array<object>。

正文在summary，incident_briefing可无附件。generated_at是产品生成时间，不能代替metadata中的实际观测/分析目标时刻。本机增强assets字段及命名见资源文档，旧版可只给asset_id/dataset_id/asset_type/label/sort_order；新增字段尚未确认生产部署。例12-product.json。

## 7 GET/HEAD /api/v1/datasets/{dataset_id}/content

路径dataset_id:string。无session_id、Cookie或临时签名参数；当前依赖获准网络入口，不代表适合直接公网开放。资源URL非短期签名，未设置URL TTL；只要登记和文件仍在且入口可达即可访问，产品有效期与文件下载可达是两件事。

GET返回字节；HEAD同状态/长度等头但无正文。支持Content-Type、Content-Length、Content-Disposition附件文件名、Accept-Ranges:bytes、ETag=SHA256。单段Range有效206，非法/多段416；If-Range只认匹配的强ETag，失配发全文件；If-None-Match可304。HEAD/Range长度代表本次响应长度，不一定整个文件，结合Content-Range。

缓存Cache-Control为private,no-cache（允许验证后复用，不等于no-store）；无CDN/对象存储签名服务。未知数据集404，已登记但本节点文件不存在410。取消网络下载仅中止传输，不撤销产品/申请。

可补查GET /api/v1/datasets/{dataset_id}，成功200含file_name/format/size_bytes/sha256、metadata及content_url；file_path从公开响应移除。本机13-*记录是实际返回，不需要向成员逐个索要文件大小。

## 下载、并发、访问与版本限制

单次JSON64KiB。代码上传默认上限20GiB，正式实例可配置且本轮未读取私有运行配置；**这不是允许浏览器一次渲染20GiB**。典型NC样例6,294,232字节。前端下载/解码的单文件上限、并发上限、每秒请求限额尚无压测承诺；不要填写不存在的限流指标。现有线程HTTP服务不是公网并发容量承诺。

普通用户选岗/查询/申请不用成员机器Bearer；上传、领取、结果登记等内部写接口正式环境需要独立机器授权，不能把本机开发环境无鉴权行为搬到生产。现有GET资源没有绑定接收会话的逐对象访问控制；公网化需额外认证/网关审查。

API路径v1、字段增补尽量兼容；没有正式承诺旧版本保留时长/自动通知渠道。本次以交接包日期冻结参考，双方修改前通知约定联系人；姓名及联系方式由用户确认，不从SSH账号推断。
