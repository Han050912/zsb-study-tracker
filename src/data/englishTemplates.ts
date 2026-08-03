/**
 * 内置英语高分作文模板库（三大分类，点击「生成内置模板库」一键写入）。
 * 内容为经典高分框架句式，可按个人风格二次编辑。
 */
export interface BuiltinTemplate {
  title: string
  category: '议论文' | '图表文' | '信件文'
  content: string
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ===================== 议论文（5 套） =====================
  {
    title: '议论文 · 观点对立型（有人认为…另有人认为…）',
    category: '议论文',
    content: `【开头段】
When it comes to ______, people's opinions vary from person to person. Some people hold the view that ______, while others argue that ______.

【主体段一：正方观点】
Those who are in favor of ______ have their reasons. To begin with, ______. What's more, ______. A typical example is that ______.

【主体段二：反方观点】
However, other people take the opposite view. They believe that ______, mainly because ______. In addition, ______.

【结尾段：我的看法】
As far as I am concerned, both sides have their merits, but I prefer the former/latter. Only in this way can we ______.`
  },
  {
    title: '议论文 · 现象分析型（原因 + 影响 + 建议）',
    category: '议论文',
    content: `【开头段：引出话题】
Nowadays, there is a growing concern over ______. It has become a common phenomenon that ______, which deserves our close attention.

【主体段一：分析原因】
Several factors account for this phenomenon. First of all, ______. Secondly, ______. Last but not least, ______.

【主体段二：阐明影响】
As a result, ______ has brought about a series of consequences. On the one hand, ______. On the other hand, ______.

【结尾段：提出建议】
Therefore, it is high time that we took effective measures to ______. Only through joint efforts can we ______.`
  },
  {
    title: '议论文 · 利弊分析型（优点 vs 缺点）',
    category: '议论文',
    content: `【开头段】
With the rapid development of ______, ______ has become increasingly popular among people. Like everything else, it has both advantages and disadvantages.

【主体段一：优点】
On the positive side, ______ brings us great convenience. For one thing, ______. For another, ______.

【主体段二：缺点】
However, every coin has two sides. The most obvious problem is that ______. Worse still, ______.

【结尾段：权衡观点】
In my opinion, the advantages of ______ outweigh its disadvantages, as long as we use it properly and reasonably.`
  },
  {
    title: '议论文 · 问题解决型（问题 + 对策）',
    category: '议论文',
    content: `【开头段：提出问题】
In recent years, ______ has become a serious problem that we have to face. It is reported that ______.

【主体段：解决方案】
To solve this problem, several measures should be taken. Above all, it is essential that ______. Besides, ______ is also of great importance. More importantly, only by ______ can we ______.

【结尾段：总结展望】
In conclusion, although the problem of ______ is difficult to solve overnight, I firmly believe that with our continuous efforts, ______.`
  },
  {
    title: '议论文 · 名言警句型（谚语阐释）',
    category: '议论文',
    content: `【开头段：引出名言】
There is a famous saying going like this: "______." Simple as it is, the saying conveys a profound truth that ______.

【主体段一：阐释含义】
What the saying emphasizes is that ______. That is to say, ______ plays an indispensable role in our life and study.

【主体段二：举例论证】
A case in point is ______. Take ______ for example. Without ______, he/she could not have ______.

【结尾段：联系自身】
As a student, I have benefited a lot from this saying. Whenever I ______, I always remind myself that ______.`
  },
  // ===================== 图表文（2 套） =====================
  {
    title: '图表文 · 数据变化型（趋势描述 + 分析）',
    category: '图表文',
    content: `【开头段：描述图表】
As is clearly shown in the chart/table, great changes have taken place in ______. According to the figures, ______ increased/decreased sharply from ______ in ______ to ______ in ______.

【主体段：数据对比】
It can be seen from the data that ______. By contrast, ______. What deserves special attention is that ______, which accounts for ______% of the total.

【分析段：解释原因】
There are at least two reasons for this trend. Firstly, ______. Secondly, ______.

【结尾段：总结预测】
From what has been discussed above, we can safely draw the conclusion that ______. It is believed that this trend will continue in the years to come.`
  },
  {
    title: '图表文 · 占比分布型（饼图/柱状图）',
    category: '图表文',
    content: `【开头段：总述图表】
The pie/bar chart clearly illustrates the proportion of ______. As can be seen from the chart, ______ takes up the largest share, reaching ______%.

【主体段：分项描述】
Specifically, ______ ranks first with ______%, followed by ______ at ______%. In comparison, ______ only makes up ______%, which is the smallest part.

【分析段：背后原因】
The reasons behind this phenomenon are as follows. To begin with, ______. Furthermore, ______.

【结尾段：观点总结】
In summary, the chart reflects that ______. From my perspective, we should pay more attention to ______.`
  },
  // ===================== 信件文（3 套） =====================
  {
    title: '信件文 · 建议信（Learning/Study Advice）',
    category: '信件文',
    content: `Dear ______,

I am glad to hear from you. Knowing that you are having trouble with ______, I am writing to offer you some practical suggestions.

First of all, it would be a good idea to ______, which can help you ______. In addition, I strongly recommend that you ______, because ______. Last but not least, why not ______? I am sure it will make a difference.

I hope my suggestions will be of some help to you. Looking forward to your good news.

Yours sincerely,
Li Hua`
  },
  {
    title: '信件文 · 邀请信（活动邀请）',
    category: '信件文',
    content: `Dear ______,

How is everything going? I am writing to invite you to take part in ______, which will be held at ______ on ______.

The activity is aimed at ______. During the activity, we will ______. What is more exciting is that ______. I am convinced that you will have a wonderful time.

If you are interested, please let me know before ______ so that I can make necessary arrangements. I sincerely hope you can come.

Yours,
Li Hua`
  },
  {
    title: '信件文 · 感谢/申请信（通用书信框架）',
    category: '信件文',
    content: `Dear ______,

I am writing to express my sincere gratitude for / apply for ______.

【感谢信主体】It was very kind of you to ______. Without your help, I would not have ______. Your kindness has left a deep impression on me.
【申请信主体】I believe I am qualified for ______. Not only do I have a good command of ______, but I also have rich experience in ______. I would appreciate it if you could give me the opportunity.

Thank you again for your time and consideration. I am looking forward to your reply.

Yours faithfully,
Li Hua`
  }
]
