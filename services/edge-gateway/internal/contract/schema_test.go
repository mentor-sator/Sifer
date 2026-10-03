package contract

import "testing"

func TestSchemaMajorComesFromContractPackage(t *testing.T) {
	if SchemaMajor != 1 {
		t.Fatalf("SchemaMajor = %d, want 1", SchemaMajor)
	}
}

func TestMajorFromPackage(t *testing.T) {
	major, err := MajorFromPackage("sifer.v7")
	if err != nil || major != 7 {
		t.Fatalf("MajorFromPackage(sifer.v7) = %d, %v", major, err)
	}
	for _, pkg := range []string{"sifer", "sifer.vx", "sifer.v"} {
		if _, err := MajorFromPackage(pkg); err == nil {
			t.Fatalf("MajorFromPackage(%q) accepted a package without a major", pkg)
		}
	}
}
