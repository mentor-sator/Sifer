package contract

import (
	"fmt"
	"strconv"
	"strings"

	siferv1 "github.com/mentor-sator/Sifer/gen/go/sifer/v1"
)

var SchemaMajor = mustMajor(string(siferv1.File_sifer_v1_envelope_proto.Package()))

func MajorFromPackage(pkg string) (uint32, error) {
	index := strings.LastIndex(pkg, ".v")
	if index < 0 {
		return 0, fmt.Errorf("contract package %q carries no major version", pkg)
	}
	major, err := strconv.ParseUint(pkg[index+2:], 10, 32)
	if err != nil {
		return 0, fmt.Errorf("contract package %q carries no major version", pkg)
	}
	return uint32(major), nil
}

func mustMajor(pkg string) uint32 {
	major, err := MajorFromPackage(pkg)
	if err != nil {
		panic(err)
	}
	return major
}
