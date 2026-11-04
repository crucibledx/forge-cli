$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# The trusted bootstrap cannot compile or launch the target until its parent
# has assigned this process to the kill-on-close job. Target stdin is NUL.
if ([Console]::In.ReadLine() -ne 'forge-owned-go') { exit 125 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class ForgeOwnedProcess {
  [StructLayout(LayoutKind.Sequential)]
  struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string reserved, desktop, title;
    public int x,y,xSize,ySize,xCount,yCount,fill,flags;
    public short show,reservedSize; public IntPtr reservedBytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name,uint access,uint share,ref SECURITY_ATTRIBUTES security,uint creation,uint attributes,IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFO startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool success) { if(!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static int Run(string executable,string command,string cwd,string jobName) {
    IntPtr output=IntPtr.Zero,error=IntPtr.Zero,input=IntPtr.Zero,job=IntPtr.Zero;
    PROCESS_INFORMATION child=new PROCESS_INFORMATION(); bool resumed=false;
    try {
      // QUERY only; no inheritable job handle survives target execution.
      job=OpenJobObjectW(4,false,jobName); Check(job!=IntPtr.Zero);
      IntPtr self=GetCurrentProcess();
      Check(DuplicateHandle(self,GetStdHandle(-11),self,out output,0,true,2));
      Check(DuplicateHandle(self,GetStdHandle(-12),self,out error,0,true,2));
      SECURITY_ATTRIBUTES security=new SECURITY_ATTRIBUTES();
      security.length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); security.inherit=1;
      input=CreateFileW("NUL",0x80000000,3,ref security,3,0x80,IntPtr.Zero);
      Check(input!=new IntPtr(-1));
      STARTUPINFO startup=new STARTUPINFO();
      startup.cb=Marshal.SizeOf(typeof(STARTUPINFO)); startup.flags=0x100;
      startup.input=input; startup.output=output; startup.error=error;
      // Children inherit the already-owned job, with no breakaway flag.
      Check(CreateProcessW(executable,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out child));
      bool member; Check(IsProcessInJob(child.process,job,out member)); Check(member);
      CloseHandle(job); job=IntPtr.Zero;
      Check(ResumeThread(child.thread)!=0xffffffff); resumed=true;
      CloseHandle(output); output=IntPtr.Zero; CloseHandle(error); error=IntPtr.Zero;
      CloseHandle(input); input=IntPtr.Zero;
      Check(WaitForSingleObject(child.process,0xffffffff)==0);
      uint code; Check(GetExitCodeProcess(child.process,out code)); return unchecked((int)code);
    } finally {
      if(!resumed && child.process!=IntPtr.Zero) TerminateProcess(child.process,125);
      if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero) CloseHandle(child.process);
      if(job!=IntPtr.Zero) CloseHandle(job);
      if(output!=IntPtr.Zero) CloseHandle(output);
      if(error!=IntPtr.Zero) CloseHandle(error);
      if(input!=IntPtr.Zero && input!=new IntPtr(-1)) CloseHandle(input);
    }
  }
}
'@
