import React from 'react';
import { cn } from '@/lib/utils';

interface DepthBarProps {
    bidSize: number;
    askSize: number;
    className?: string;
}

export function DepthBar({ bidSize, askSize, className }: DepthBarProps) {
    const total = bidSize + askSize;

    if (total === 0) {
        return (
            <div className={cn("h-1.5 w-full bg-gray-800 rounded-full overflow-hidden opacity-30", className)} />
        );
    }

    const bidPercent = (bidSize / total) * 100;
    const askPercent = (askSize / total) * 100;

    return (
        <div className={cn("flex flex-col gap-1 w-full max-w-[80px]", className)}>
            <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-gray-800">
                <div
                    className="bg-emerald-500/80 transition-all duration-300 ease-out"
                    style={{ width: `${bidPercent}%` }}
                />
                <div
                    className="bg-rose-500/80 transition-all duration-300 ease-out"
                    style={{ width: `${askPercent}%` }}
                />
            </div>
            {/* Optional labels below if needed, but keeping it minimal for table */}
        </div>
    );
}
