export const SAMPLE_555_KICAD_XML = `<?xml version="1.0" encoding="utf-8"?>
<export version="E">
  <design>
    <source>blinker.kicad_sch</source>
    <tool>Eeschema 8.0</tool>
  </design>
  <components>
    <comp ref="C1"><value>10uF</value><footprint>Capacitor_THT:CP_Radial_D5.0mm_P2.00mm</footprint><libsource lib="Device" part="C_Polarized" description="Polarized capacitor"/></comp>
    <comp ref="C2"><value>10nF</value><footprint>Capacitor_THT:C_Disc_D3.0mm_W1.6mm_P2.50mm</footprint><libsource lib="Device" part="C" description="Unpolarized capacitor"/></comp>
    <comp ref="D1"><value>LED</value><footprint>LED_THT:LED_D5.0mm</footprint><libsource lib="Device" part="LED" description="Light emitting diode"/></comp>
    <comp ref="J1"><value>Power</value><footprint>Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical</footprint><libsource lib="Connector" part="Conn_01x02" description="Generic connector"/></comp>
    <comp ref="R1"><value>1k</value><footprint>Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal</footprint><libsource lib="Device" part="R" description="Resistor"/></comp>
    <comp ref="R2"><value>10k</value><footprint>Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal</footprint><libsource lib="Device" part="R" description="Resistor"/></comp>
    <comp ref="R3"><value>330</value><footprint>Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal</footprint><libsource lib="Device" part="R" description="Resistor"/></comp>
    <comp ref="U1"><value>NE555P</value><footprint>Package_DIP:DIP-8_W7.62mm</footprint><libsource lib="Timer" part="NE555P" description="Precision Timers, 555 compatible, PDIP-8"/></comp>
  </components>
  <libparts>
    <libpart lib="Device" part="C"><pins><pin num="1" name="~" type="passive"/><pin num="2" name="~" type="passive"/></pins></libpart>
    <libpart lib="Device" part="C_Polarized"><pins><pin num="1" name="+" type="passive"/><pin num="2" name="-" type="passive"/></pins></libpart>
    <libpart lib="Device" part="LED"><pins><pin num="1" name="K" type="passive"/><pin num="2" name="A" type="passive"/></pins></libpart>
    <libpart lib="Device" part="R"><pins><pin num="1" name="~" type="passive"/><pin num="2" name="~" type="passive"/></pins></libpart>
    <libpart lib="Connector" part="Conn_01x02"><pins><pin num="1" name="Pin_1" type="passive"/><pin num="2" name="Pin_2" type="passive"/></pins></libpart>
    <libpart lib="Timer" part="NE555P">
      <pins>
        <pin num="1" name="GND" type="power_in"/>
        <pin num="2" name="TR" type="input"/>
        <pin num="3" name="Q" type="output"/>
        <pin num="4" name="R" type="input"/>
        <pin num="5" name="CV" type="input"/>
        <pin num="6" name="THR" type="input"/>
        <pin num="7" name="DIS" type="input"/>
        <pin num="8" name="VCC" type="power_in"/>
      </pins>
    </libpart>
  </libparts>
  <nets>
    <net code="1" name="+5V">
      <node ref="J1" pin="1" pinfunction="Pin_1"/>
      <node ref="U1" pin="8" pinfunction="VCC"/>
      <node ref="U1" pin="4" pinfunction="R"/>
      <node ref="R1" pin="1"/>
    </net>
    <net code="2" name="GND">
      <node ref="J1" pin="2" pinfunction="Pin_2"/>
      <node ref="U1" pin="1" pinfunction="GND"/>
      <node ref="C1" pin="2" pinfunction="-"/>
      <node ref="C2" pin="2"/>
      <node ref="D1" pin="1" pinfunction="K"/>
    </net>
    <net code="3" name="/DIS">
      <node ref="U1" pin="7" pinfunction="DIS"/>
      <node ref="R1" pin="2"/>
      <node ref="R2" pin="1"/>
    </net>
    <net code="4" name="/THR">
      <node ref="U1" pin="6" pinfunction="THR"/>
      <node ref="U1" pin="2" pinfunction="TR"/>
      <node ref="R2" pin="2"/>
      <node ref="C1" pin="1" pinfunction="+"/>
    </net>
    <net code="5" name="Net-(U1-CV)">
      <node ref="U1" pin="5" pinfunction="CV"/>
      <node ref="C2" pin="1"/>
    </net>
    <net code="6" name="/OUT">
      <node ref="U1" pin="3" pinfunction="Q"/>
      <node ref="R3" pin="1"/>
    </net>
    <net code="7" name="Net-(D1-A)">
      <node ref="R3" pin="2"/>
      <node ref="D1" pin="2" pinfunction="A"/>
    </net>
  </nets>
</export>
`;

export const TEXT_FORMAT_EXAMPLE = `# One component per "part" line: part REF VALUE FOOTPRINT
part U1 NE555 DIP-8
part R1 10k
part D1 LED

# One net per line: NAME: REF.PIN REF.PIN ...
VCC: U1.8 U1.4 R1.1
GND: U1.1 D1.1
OUT: U1.3 R1.2 D1.2
`;
