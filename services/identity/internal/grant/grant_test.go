package grant

import (
	"bytes"
	"errors"
	"testing"
)

var binding = Binding{UserID: "8d2f0c6e-7a51-4c1b-9a3e-2f4b5c6d7e8f", Provider: "google"}

func testSealer(t *testing.T) *Sealer {
	t.Helper()
	encoded, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	key, err := ParseKey(encoded)
	if err != nil {
		t.Fatalf("ParseKey: %v", err)
	}
	sealer, err := NewSealer(key)
	if err != nil {
		t.Fatal(err)
	}
	return sealer
}

func TestSealOpenRoundTrip(t *testing.T) {
	sealer := testSealer(t)
	sealed, err := sealer.Seal(binding, Secrets{Access: "ya29.access", Refresh: "1//refresh"})
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Contains(sealed.AccessCT, []byte("ya29")) || bytes.Contains(sealed.RefreshCT, []byte("refresh")) {
		t.Fatal("ciphertext contains plaintext")
	}
	opened, err := sealer.Open(binding, sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if opened.Access != "ya29.access" || opened.Refresh != "1//refresh" {
		t.Fatalf("opened = %+v", opened)
	}
}

func TestEachSealUsesAFreshDataKey(t *testing.T) {
	sealer := testSealer(t)
	first, _ := sealer.Seal(binding, Secrets{Access: "a", Refresh: "r"})
	second, _ := sealer.Seal(binding, Secrets{Access: "a", Refresh: "r"})
	if bytes.Equal(first.DEKWrapped, second.DEKWrapped) || bytes.Equal(first.AccessCT, second.AccessCT) {
		t.Fatal("two seals produced identical ciphertext")
	}
}

func TestOpenRefusesAnotherBinding(t *testing.T) {
	sealer := testSealer(t)
	sealed, _ := sealer.Seal(binding, Secrets{Access: "a", Refresh: "r"})
	others := []Binding{
		{UserID: "00000000-0000-0000-0000-000000000000", Provider: "google"},
		{UserID: binding.UserID, Provider: "microsoft"},
	}
	for _, other := range others {
		if _, err := sealer.Open(other, sealed); !errors.Is(err, ErrCorrupt) {
			t.Fatalf("Open(%+v) error = %v, want ErrCorrupt", other, err)
		}
	}
}

func TestOpenRefusesSwappedFields(t *testing.T) {
	sealer := testSealer(t)
	sealed, _ := sealer.Seal(binding, Secrets{Access: "a", Refresh: "r"})
	sealed.AccessCT, sealed.RefreshCT = sealed.RefreshCT, sealed.AccessCT
	if _, err := sealer.Open(binding, sealed); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("error = %v, want ErrCorrupt", err)
	}
}

func TestOpenRefusesTamperingAndAnotherKey(t *testing.T) {
	sealer := testSealer(t)
	sealed, _ := sealer.Seal(binding, Secrets{Access: "a", Refresh: "r"})

	tampered := sealed
	tampered.AccessCT = append([]byte(nil), sealed.AccessCT...)
	tampered.AccessCT[len(tampered.AccessCT)-1] ^= 1
	if _, err := sealer.Open(binding, tampered); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("tampered error = %v", err)
	}

	short := sealed
	short.DEKWrapped = sealed.DEKWrapped[:5]
	if _, err := sealer.Open(binding, short); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("short error = %v", err)
	}

	if _, err := testSealer(t).Open(binding, sealed); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("other key error = %v", err)
	}
}

func TestParseKeyRejectsBadInput(t *testing.T) {
	for _, encoded := range []string{"", "not base64!", "c2hvcnQ=", "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB"} {
		if _, err := ParseKey(encoded); !errors.Is(err, ErrInvalidKey) {
			t.Fatalf("ParseKey(%q) error = %v, want ErrInvalidKey", encoded, err)
		}
	}
	if _, err := NewSealer(make([]byte, 16)); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("NewSealer(16 bytes) error = %v", err)
	}
}
