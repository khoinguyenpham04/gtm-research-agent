'use client'

import { useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Sparkle } from 'lucide-react'
import { motion, useScroll, useTransform, type Variants } from 'motion/react'

import Grainient from '@/components/Grainient'
import { Button } from '@/components/ui/button'
import { HeroHeader } from './header'

const textBlockVariants: Variants = {
    hidden: { opacity: 0, y: 50 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { type: 'spring', stiffness: 100, damping: 20, mass: 1.2, delay: 0.2 },
    },
}

const imageBlockVariants: Variants = {
    hidden: { opacity: 0, scale: 0.9 },
    visible: {
        opacity: 1,
        scale: 1,
        transition: { type: 'spring', stiffness: 100, damping: 20, mass: 1, delay: 0.5 },
    },
}

export default function HeroSection() {
    const scrollRef = useRef<HTMLElement>(null)

    const { scrollYProgress } = useScroll({
        target: scrollRef,
        offset: ['start start', 'end start'],
    })

    const mainImageScale = useTransform(scrollYProgress, [0, 1], [1, 1.2])

    return (
        <>
            <HeroHeader />
            <main>
                <section ref={scrollRef} className="border-e-foreground relative overflow-hidden">
                    <div className="absolute top-1 left-1/2 -z-10 h-[calc(100%-8rem)] w-[calc(100%-0.5rem)] -translate-x-1/2 overflow-hidden rounded-2xl sm:top-2 sm:w-[calc(100%-1rem)] md:rounded-[2rem] lg:h-[calc(100%-14rem)]">
                        <Grainient
                            color1="#f5f5ff"
                            color2="#70a3f5"
                            color3="#6fbcec"
                            timeSpeed={2.55}
                            colorBalance={-0.19}
                            warpStrength={1.6}
                            warpFrequency={5}
                            warpSpeed={2}
                            warpAmplitude={50}
                            blendAngle={0}
                            blendSoftness={0.05}
                            rotationAmount={500}
                            noiseScale={1.4}
                            grainAmount={0.08}
                            grainScale={2}
                            grainAnimated={false}
                            contrast={1.5}
                            gamma={1}
                            saturation={1}
                            centerX={0}
                            centerY={0}
                            zoom={0.8}
                        />
                    </div>

                    <div className="py-20 md:py-36">
                        <motion.div
                            animate="visible"
                            className="relative z-10 mx-auto max-w-5xl px-6 text-center"
                            initial="hidden"
                            variants={textBlockVariants}
                        >
                            <div>
                                <Link
                                    className="hover:bg-foreground/5 mx-auto flex w-fit items-center justify-center gap-2 rounded-md py-0.5 pl-1 pr-3 transition-colors duration-150"
                                    href="/dashboard"
                                >
                                    <div
                                        aria-hidden
                                        className="border-background bg-linear-to-b dark:inset-shadow-2xs from-primary to-foreground relative flex size-5 items-center justify-center rounded border shadow-md shadow-black/20 ring-1 ring-black/10"
                                    >
                                        <div className="absolute inset-x-0 inset-y-1.5 border-y border-dotted border-white/25"></div>
                                        <div className="absolute inset-x-1.5 inset-y-0 border-x border-dotted border-white/25"></div>
                                        <Sparkle className="size-3 fill-white stroke-white drop-shadow" />
                                    </div>
                                    <span className="font-medium">Enterprise GTM research workspace</span>
                                </Link>

                                <h1 className="mx-auto mt-8 max-w-4xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
                                    Agentic go-to-market research grounded in your own source material
                                </h1>
                                <p className="text-muted-foreground mx-auto my-6 max-w-2xl text-balance text-xl">
                                    Upload reports, scope a workspace, and let Clarion plan, research,
                                    validate, and draft an evidence-backed market brief with citations
                                    and explicit gaps.
                                </p>

                                <div className="flex items-center justify-center gap-3">
                                    <Button asChild size="lg">
                                        <Link href="/dashboard">
                                            <span className="text-nowrap">Open Dashboard</span>
                                        </Link>
                                    </Button>
                                    <Button asChild size="lg" variant="outline">
                                        <Link href="/dashboard/data-library">
                                            <span className="text-nowrap">View Data Library</span>
                                        </Link>
                                    </Button>
                                </div>
                            </div>
                        </motion.div>

                        <div className="relative">
                            <motion.div
                                animate="visible"
                                className="relative z-10 mx-auto max-w-5xl px-6"
                                initial="hidden"
                                variants={imageBlockVariants}
                            >
                                <div className="mt-12 md:mt-16">
                                    <motion.div
                                        className="bg-background rounded-(--radius) relative mx-auto overflow-hidden border border-transparent shadow-lg shadow-black/10 ring-1 ring-black/10"
                                        style={{ scale: mainImageScale }}
                                    >
                                        <Image
                                            alt="Clarion dashboard preview"
                                            height={1842}
                                            priority
                                            src="/Clarion.png"
                                            width={2880}
                                        />
                                    </motion.div>
                                </div>
                            </motion.div>
                        </div>
                    </div>
                </section>
            </main>
        </>
    )
}
