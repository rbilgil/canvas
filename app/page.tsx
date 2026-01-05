import {
	SignInButton,
	SignUpButton,
	SignedIn,
	SignedOut,
	UserButton,
} from "@clerk/nextjs";
import { Sparkles, Wand2, Layers, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
	return (
		<div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
			{/* Header */}
			<header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
				<div className="flex items-center gap-2">
					<div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-lg flex items-center justify-center">
						<Sparkles className="w-5 h-5 text-white" />
					</div>
					<span className="font-semibold text-xl text-slate-900 dark:text-white">
						Canvas AI
					</span>
				</div>
				<nav className="flex items-center gap-4">
					<SignedOut>
						<SignInButton mode="modal">
							<Button variant="ghost">Sign In</Button>
						</SignInButton>
						<SignUpButton mode="modal">
							<Button>Get Started</Button>
						</SignUpButton>
					</SignedOut>
					<SignedIn>
						<Link href="/app">
							<Button variant="ghost">Open Canvas</Button>
						</Link>
						<UserButton />
					</SignedIn>
				</nav>
			</header>

			{/* Hero Section */}
			<main className="max-w-6xl mx-auto px-6 pt-20 pb-32">
				<div className="text-center max-w-3xl mx-auto">
					<div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-sm font-medium mb-6">
						<Wand2 className="w-4 h-4" />
						AI-Powered Design
					</div>
					<h1 className="text-5xl sm:text-6xl font-bold text-slate-900 dark:text-white leading-tight mb-6">
						Create stunning graphics with{" "}
						<span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 to-indigo-600">
							AI assistance
						</span>
					</h1>
					<p className="text-xl text-slate-600 dark:text-slate-400 mb-10 max-w-2xl mx-auto">
						A powerful canvas editor that combines traditional design tools with
						AI-powered image generation and editing. Bring your creative visions
						to life.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<SignedOut>
							<SignUpButton mode="modal">
								<Button size="lg" className="text-base px-8">
									Start Creating
								</Button>
							</SignUpButton>
							<SignInButton mode="modal">
								<Button size="lg" variant="outline" className="text-base px-8">
									Sign In
								</Button>
							</SignInButton>
						</SignedOut>
						<SignedIn>
							<Link href="/app">
								<Button size="lg" className="text-base px-8">
									Open Canvas
								</Button>
							</Link>
						</SignedIn>
					</div>
				</div>

				{/* Features */}
				<div className="grid md:grid-cols-3 gap-8 mt-32">
					<div className="p-6 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-4">
							<Layers className="w-6 h-6 text-violet-600 dark:text-violet-400" />
						</div>
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
							Vector & Raster Tools
						</h3>
						<p className="text-slate-600 dark:text-slate-400">
							Draw shapes, lines, and text with precision. Import and manipulate
							images with ease.
						</p>
					</div>
					<div className="p-6 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mb-4">
							<Wand2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
						</div>
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
							AI Image Generation
						</h3>
						<p className="text-slate-600 dark:text-slate-400">
							Generate images from text prompts and edit existing images with
							natural language commands.
						</p>
					</div>
					<div className="p-6 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
						<div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-4">
							<Zap className="w-6 h-6 text-blue-600 dark:text-blue-400" />
						</div>
						<h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
							Smart Commands
						</h3>
						<p className="text-slate-600 dark:text-slate-400">
							Right-click anywhere to open the AI command palette. Move, resize,
							and style elements with natural language.
						</p>
					</div>
				</div>
			</main>

			{/* Footer */}
			<footer className="border-t border-slate-200 dark:border-slate-800 py-8">
				<div className="max-w-6xl mx-auto px-6 text-center text-sm text-slate-500 dark:text-slate-400">
					Built with Next.js, Convex, and Clerk
				</div>
			</footer>
		</div>
	);
}
