using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Sifer
{
    public static class CredentialStore
    {
        private const int CredTypeGeneric = 1;
        private const int PersistLocalMachine = 2;
        private const int ErrorNotFound = 1168;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Credential
        {
            public int Flags;
            public int Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public int CredentialBlobSize;
            public IntPtr CredentialBlob;
            public int Persist;
            public int AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredWriteW(ref Credential credential, int flags);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);

        [DllImport("advapi32.dll")]
        private static extern void CredFree(IntPtr buffer);

        public static void Write(string target, string userName, string secret)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(secret);
            IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
            try
            {
                Marshal.Copy(bytes, 0, blob, bytes.Length);
                Credential credential = new Credential
                {
                    Type = CredTypeGeneric,
                    TargetName = target,
                    UserName = userName,
                    CredentialBlobSize = bytes.Length,
                    CredentialBlob = blob,
                    Persist = PersistLocalMachine
                };
                if (!CredWriteW(ref credential, 0))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
            }
            finally
            {
                Marshal.Copy(new byte[bytes.Length], 0, blob, bytes.Length);
                Array.Clear(bytes, 0, bytes.Length);
                Marshal.FreeHGlobal(blob);
            }
        }

        public static string Read(string target)
        {
            IntPtr pointer;
            if (!CredReadW(target, CredTypeGeneric, 0, out pointer))
            {
                int error = Marshal.GetLastWin32Error();
                if (error == ErrorNotFound)
                {
                    return null;
                }
                throw new Win32Exception(error);
            }
            try
            {
                Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
                byte[] bytes = new byte[credential.CredentialBlobSize];
                Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
                return Encoding.UTF8.GetString(bytes);
            }
            finally
            {
                CredFree(pointer);
            }
        }
    }
}
