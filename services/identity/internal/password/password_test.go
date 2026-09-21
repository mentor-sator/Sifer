package password

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"
)

var fast = Params{Memory: 1024, Iterations: 1, Parallelism: 1, SaltLength: 16, KeyLength: 32}

var phc = regexp.MustCompile(`^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$`)

func TestHashIsPHCAndSalted(t *testing.T) {
	h := NewHasher(fast, 1)
	first, err := h.Hash(context.Background(), "correct horse battery staple")
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	second, _ := h.Hash(context.Background(), "correct horse battery staple")
	if !phc.MatchString(first) {
		t.Fatalf("not PHC argon2id: %s", first)
	}
	if first == second {
		t.Fatal("two hashes of one password are equal; salt missing")
	}
}

func TestDefaultParamsEncodeAsExpected(t *testing.T) {
	h := NewHasher(Default, 1)
	encoded, err := h.Hash(context.Background(), "correct horse battery staple")
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$v=19$m=65536,t=3,p=4$") {
		t.Fatalf("unexpected parameters: %s", encoded)
	}
}

func TestVerify(t *testing.T) {
	h := NewHasher(fast, 1)
	encoded, _ := h.Hash(context.Background(), "correct horse battery staple")
	rehash, err := h.Verify(context.Background(), "correct horse battery staple", encoded)
	if err != nil || rehash {
		t.Fatalf("Verify = %v, %v", rehash, err)
	}
	if _, err := h.Verify(context.Background(), "correct horse battery stapler", encoded); !errors.Is(err, ErrMismatch) {
		t.Fatalf("wrong password: %v", err)
	}
}

func TestVerifyFlagsOldParameters(t *testing.T) {
	encoded, _ := NewHasher(fast, 1).Hash(context.Background(), "correct horse battery staple")
	stronger := fast
	stronger.Iterations = 2
	rehash, err := NewHasher(stronger, 1).Verify(context.Background(), "correct horse battery staple", encoded)
	if err != nil || !rehash {
		t.Fatalf("Verify = %v, %v; want rehash", rehash, err)
	}
}

func TestVerifyRejectsMalformedHashes(t *testing.T) {
	h := NewHasher(fast, 1)
	good, _ := h.Hash(context.Background(), "correct horse battery staple")
	parts := strings.Split(good, "$")
	cases := map[string]string{
		"empty":        "",
		"bcrypt":       "$2b$10$abcdefghijklmnopqrstuv",
		"argon2i":      strings.Replace(good, "argon2id", "argon2i", 1),
		"old version":  strings.Replace(good, "v=19", "v=16", 1),
		"huge memory":  strings.Replace(good, "m=1024", "m=4194304", 1),
		"zero time":    strings.Replace(good, "t=1", "t=0", 1),
		"bad salt":     strings.Join([]string{"", parts[1], parts[2], parts[3], "!!!", parts[5]}, "$"),
		"short key":    strings.Join([]string{"", parts[1], parts[2], parts[3], parts[4], "AAAA"}, "$"),
		"extra fields": good + "$x",
	}
	for name, encoded := range cases {
		if _, err := h.Verify(context.Background(), "correct horse battery staple", encoded); !errors.Is(err, ErrMalformedHash) {
			t.Errorf("%s: err = %v, want ErrMalformedHash", name, err)
		}
	}
}

func TestConcurrencyLimitHonoursContext(t *testing.T) {
	h := NewHasher(fast, 1)
	h.slots <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := h.Hash(ctx, "correct horse battery staple"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Hash while saturated: %v", err)
	}
}
