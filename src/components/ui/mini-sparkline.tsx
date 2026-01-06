"use client";

import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

interface SparklineProps {
    data: { mid: number }[];
    color?: string;
    width?: number;
    height?: number;
}

export function MiniSparkline({ data, color = "#3b82f6", width = 60, height = 20 }: SparklineProps) {
    if (!data || data.length < 2) {
        return <div style={{ width, height }} className="bg-gray-800/20 rounded opacity-20" />;
    }

    // Determine trend color if not overridden
    const start = data[0].mid;
    const end = data[data.length - 1].mid;
    const trendColor = end > start ? "#10b981" : end < start ? "#ef4444" : "#6b7280";
    const strokeColor = color === "#3b82f6" ? trendColor : color;

    return (
        <div style={{ width, height }}>
            <LineChart width={width} height={height} data={data}>
                <YAxis domain={['dataMin', 'dataMax']} hide />
                <Line
                    type="monotone"
                    dataKey="mid"
                    stroke={strokeColor}
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                />
            </LineChart>
        </div>
    );
}
