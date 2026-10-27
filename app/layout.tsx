import type { Metadata } from 'next';
import './globals.css';
import './compute.css';
import './assistant.css';
import './project.css';
import './spectra.css';
import './task-monitor.css';
import './research-figure.css';
export const metadata: Metadata = {
 title: 'Pd Atlas · XAFS 分析助手',
 description: '拖入 Athena .prj 工程，自动处理催化剂、金属箔与氧化物光谱；归一化、背景扣除、整组对照与参数选择依据',
 icons: { icon: '/favicon.svg' },
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>}
