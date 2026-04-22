export default function BackgroundBlobs() {
  return (
    <>
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/20 blur-[100px] rounded-full pointer-events-none" />
      <div className="absolute top-[40%] left-[30%] w-[20%] h-[20%] bg-teal-400/10 blur-[80px] rounded-full pointer-events-none" />
    </>
  )
}
